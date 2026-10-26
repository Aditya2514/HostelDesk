import { Role, TicketStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { AppError } from "../../lib/errors";
import { AuthenticatedUser } from "../../types/express";
import { OPEN_STATUSES } from "../tickets/tickets.service";
import { getDurationEstimate, EstimateResult } from "../scheduling/estimator";
import { simulateQueueRanges, JobDurationsInput, JobPriority } from "../scheduling/simulator";
import { ShiftWindow } from "../scheduling/shifts";

export class StaffService {
  /**
   * Retrieves the planned schedule and queue order for a staff member.
   * Authorized for:
   * - The staff member themselves
   * - Wardens (who need to inspect staff queues in their hostel)
   * - Chief Warden
   * - Admin
   */
  static async getSchedule(staffId: string, user: AuthenticatedUser) {
    const isSelf = user.id === staffId;
    const isWarden = user.role === Role.WARDEN || user.role === Role.CHIEF_WARDEN;
    const isAdmin = user.role === Role.ADMIN;

    if (!isSelf && !isWarden && !isAdmin) {
      throw new AppError(403, "FORBIDDEN", "You are not authorized to view this staff schedule");
    }

    const staff = await prisma.user.findUnique({
      where: { id: staffId },
      select: {
        id: true,
        name: true,
        role: true,
        trade: true,
        blockId: true,
        shifts: {
          select: {
            weekday: true,
            startMinute: true,
            endMinute: true,
          },
          orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
        },
      },
    });

    if (!staff || staff.role !== Role.STAFF) {
      throw new AppError(404, "NOT_FOUND", "Staff member not found");
    }

    const now = clock.now();

    // Fetch open queue tickets for this staff member
    const openTickets = await prisma.ticket.findMany({
      where: {
        assignedToId: staffId,
        status: { in: OPEN_STATUSES },
      },
      include: {
        room: { select: { number: true, floor: true } },
        block: { select: { name: true } },
        category: { select: { id: true, name: true, defaultDurationMin: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const estCache = new Map<string, EstimateResult>();
    const simJobs: JobDurationsInput[] = await Promise.all(
      openTickets.map(async (t) => {
        const cacheKey = `${t.categoryId}:${t.blockId}`;
        let est = estCache.get(cacheKey);
        if (!est) {
          est = await getDurationEstimate(t.categoryId, t.blockId);
          estCache.set(cacheKey, est);
        }
        return {
          ticketId: t.id,
          priority: t.priority as JobPriority,
          createdAt: t.createdAt,
          status: t.status,
          startedAt: t.startedAt,
          notBefore: t.preferredSlotStart,
          p50Minutes: est.p50Minutes,
          p80Minutes: est.p80Minutes,
        };
      })
    );

    const { p50Schedule, p80Schedule } = simulateQueueRanges({
      now,
      shifts: staff.shifts as ShiftWindow[],
      jobs: simJobs,
    });

    const plannedJobs = openTickets.map((t) => {
      const p50 = p50Schedule.get(t.id);
      const p80 = p80Schedule.get(t.id);

      return {
        ticketId: t.id,
        code: t.code,
        title: t.title,
        priority: t.priority,
        status: t.status,
        startAt: p50?.startAt ?? null,
        finishAt: p50?.finishAt ?? null,
        finishP80At: p80?.finishAt ?? null,
        locationType: t.locationType,
        floor: t.floor,
        roomNumber: t.room?.number ?? null,
        blockName: t.block.name,
        commonSpot: t.commonSpot ?? null,
        categoryName: t.category.name,
      };
    });

    // Sort planned jobs by startAt ascending; tickets without startAt (e.g. ON_HOLD) go to end
    plannedJobs.sort((a, b) => {
      if (a.startAt && b.startAt) {
        return a.startAt.getTime() - b.startAt.getTime();
      }
      if (a.startAt && !b.startAt) return -1;
      if (!a.startAt && b.startAt) return 1;
      return 0;
    });

    return {
      staff: {
        id: staff.id,
        name: staff.name,
        trade: staff.trade,
      },
      shifts: staff.shifts,
      jobs: plannedJobs,
    };
  }

  static async listStaff() {
    return prisma.user.findMany({
      where: { role: Role.STAFF, isActive: true },
      select: {
        id: true,
        name: true,
        trade: true,
        blockId: true,
      },
      orderBy: { name: "asc" },
    });
  }
}
