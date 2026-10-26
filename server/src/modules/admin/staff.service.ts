import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { AppError } from "../../lib/errors";
import { AuditService } from "./audit.service";
import { RoutingService } from "../scheduling/routing.service";
import { EtaService } from "../scheduling/eta.service";
import { Role, Trade, TicketStatus } from "@prisma/client";

export interface ShiftInput {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export class StaffService {
  /**
   * Generates a 12-character temporary password for staff onboarding.
   */
  static generateTemporaryPassword(length = 12): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$";
    const bytes = crypto.randomBytes(length);
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }

  /**
   * GET /api/admin/staff
   * Returns all staff with trade, active flag, open-ticket count, and shifts.
   */
  static async getStaff() {
    const staffMembers = await prisma.user.findMany({
      where: { role: Role.STAFF },
      orderBy: [{ trade: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        trade: true,
        isActive: true,
        shifts: {
          orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
          select: {
            id: true,
            weekday: true,
            startMinute: true,
            endMinute: true,
          },
        },
        _count: {
          select: {
            assignedTickets: {
              where: {
                status: {
                  in: [
                    TicketStatus.ASSIGNED,
                    TicketStatus.IN_PROGRESS,
                    TicketStatus.AWAITING_ACCESS,
                    TicketStatus.ON_HOLD,
                    TicketStatus.REOPENED,
                  ],
                },
              },
            },
          },
        },
      },
    });

    return staffMembers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      trade: s.trade,
      isActive: s.isActive,
      openTicketCount: s._count.assignedTickets,
      shifts: s.shifts,
    }));
  }

  /**
   * POST /api/admin/staff
   * Creates a new staff account with a random temporary password returned once.
   */
  static async createStaff(params: {
    actorId: string;
    name: string;
    email: string;
    trade: Trade;
  }) {
    const { actorId, name, email, trade } = params;

    if (!name?.trim()) {
      throw new AppError(400, "VALIDATION_ERROR", "Staff name is required");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      throw new AppError(400, "VALIDATION_ERROR", "Valid email address is required");
    }

    if (!Object.values(Trade).includes(trade)) {
      throw new AppError(400, "VALIDATION_ERROR", "Valid trade is required (ELECTRICIAN, PLUMBER, CARPENTER)");
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existing) {
      throw new AppError(409, "EMAIL_EXISTS", "A user with this email address already exists");
    }

    const temporaryPassword = this.generateTemporaryPassword(12);
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    return prisma.$transaction(async (tx) => {
      const staff = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
          role: Role.STAFF,
          trade,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          trade: true,
          isActive: true,
        },
      });

      // Default standard Monday-Friday 9:00 AM - 5:00 PM shift (540 to 1020 min)
      const defaultShifts = [1, 2, 3, 4, 5].map((weekday) => ({
        staffId: staff.id,
        weekday,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      }));

      await tx.staffShift.createMany({
        data: defaultShifts,
      });

      // Audit log inside same transaction
      await AuditService.logAction(
        {
          actorId,
          action: "CREATE_STAFF",
          entityType: "USER",
          entityId: staff.id,
          payload: {
            name: staff.name,
            email: staff.email,
            trade: staff.trade,
          },
        },
        tx
      );

      return {
        staff,
        temporaryPassword,
      };
    });
  }

  /**
   * PATCH /api/admin/staff/:id
   * Updates staff active status.
   * If deactivating someone with open tickets -> 409 HAS_OPEN_TICKETS listing them,
   * unless reassignOpenTickets: true.
   */
  static async updateStaffStatus(params: {
    actorId: string;
    staffId: string;
    isActive: boolean;
    reassignOpenTickets?: boolean;
  }) {
    const { actorId, staffId, isActive, reassignOpenTickets } = params;

    const staff = await prisma.user.findUnique({
      where: { id: staffId },
      select: { id: true, name: true, role: true, trade: true, isActive: true },
    });

    if (!staff || staff.role !== Role.STAFF) {
      throw new AppError(404, "STAFF_NOT_FOUND", "Staff member not found");
    }

    if (isActive === staff.isActive) {
      return { success: true, staff };
    }

    const openStatuses = [
      TicketStatus.ASSIGNED,
      TicketStatus.IN_PROGRESS,
      TicketStatus.AWAITING_ACCESS,
      TicketStatus.ON_HOLD,
      TicketStatus.REOPENED,
    ];

    // Deactivation logic
    if (!isActive) {
      const openTickets = await prisma.ticket.findMany({
        where: {
          assignedToId: staffId,
          status: { in: openStatuses },
        },
        include: {
          category: { select: { id: true, trade: true } },
        },
      });

      if (openTickets.length > 0 && !reassignOpenTickets) {
        throw new AppError(
          409,
          "HAS_OPEN_TICKETS",
          "Cannot deactivate staff with active open tickets without reassigning them.",
          {
            openTickets: openTickets.map((t) => ({
              id: t.id,
              code: t.code,
              title: t.title,
              status: t.status,
            })),
          }
        );
      }

      const reassignedStaffIds: string[] = [];
      const now = clock.now();

      await prisma.$transaction(async (tx) => {
        // 1. Mark staff inactive first so routing excludes them
        await tx.user.update({
          where: { id: staffId },
          data: { isActive: false },
        });

        // 2. Reassign each open ticket if any
        for (const ticket of openTickets) {
          const routing = await RoutingService.chooseAssignee(
            {
              categoryId: ticket.categoryId,
              blockId: ticket.blockId,
              floor: ticket.floor ?? undefined,
              priority: ticket.priority,
              createdAt: ticket.createdAt,
              trade: ticket.category.trade,
            },
            tx
          );

          if (routing) {
            await tx.ticket.update({
              where: { id: ticket.id },
              data: {
                assignedToId: routing.staffId,
                etaP50At: routing.etaP50At,
                etaP80At: routing.etaP80At,
                etaNotifiedP50At: routing.etaP50At,
              },
            });

            await tx.ticketPrediction.create({
              data: {
                ticketId: ticket.id,
                staffId: routing.staffId,
                predictedP50At: routing.etaP50At,
                predictedP80At: routing.etaP80At,
                createdAt: now,
              },
            });

            await tx.ticketEvent.create({
              data: {
                ticketId: ticket.id,
                actorId,
                fromStatus: ticket.status,
                toStatus: ticket.status,
                type: "ASSIGNED",
                note: `Automatically reassigned to staff ${routing.staffId} due to staff deactivation`,
                createdAt: now,
              },
            });

            reassignedStaffIds.push(routing.staffId);
          } else {
            // No other active staff in trade: unassign to RAISED
            await tx.ticket.update({
              where: { id: ticket.id },
              data: {
                assignedToId: null,
                status: TicketStatus.RAISED,
                etaP50At: null,
                etaP80At: null,
              },
            });

            await tx.ticketEvent.create({
              data: {
                ticketId: ticket.id,
                actorId,
                fromStatus: ticket.status,
                toStatus: TicketStatus.RAISED,
                type: "ASSIGNED",
                note: "Unassigned due to staff deactivation (no active trade staff available)",
                createdAt: now,
              },
            });
          }
        }

        // 3. Write audit log
        await AuditService.logAction(
          {
            actorId,
            action: "DEACTIVATE_STAFF",
            entityType: "USER",
            entityId: staffId,
            payload: {
              reassignedTickets: openTickets.length,
            },
          },
          tx
        );
      });

      // Post-commit guarded queue recomputes
      try {
        await EtaService.recomputeStaffQueue(staffId, "REASSIGNED_OUT");
      } catch (err) {
        console.error(`Guarded recompute failed for deactivated staff ${staffId}:`, err);
      }

      const distinctNewStaff = Array.from(new Set(reassignedStaffIds));
      for (const newStaffId of distinctNewStaff) {
        try {
          await EtaService.recomputeStaffQueue(newStaffId, "REASSIGNED_IN");
        } catch (err) {
          console.error(`Guarded recompute failed for reassigned staff ${newStaffId}:`, err);
        }
      }

      return {
        success: true,
        isActive: false,
        reassignedCount: openTickets.length,
      };
    }

    // Reactivation logic
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: staffId },
        data: { isActive: true },
        select: { id: true, name: true, email: true, trade: true, isActive: true },
      });

      await AuditService.logAction(
        {
          actorId,
          action: "ACTIVATE_STAFF",
          entityType: "USER",
          entityId: staffId,
          payload: { trade: u.trade },
        },
        tx
      );

      return u;
    });

    return { success: true, staff: updated };
  }

  /**
   * PUT /api/admin/staff/:id/shifts
   * Replaces all shift windows for a staff member.
   * Validates:
   * - 0 <= startMinute < endMinute <= 1440
   * - weekday in 0..6
   * - no overlapping windows on the same day
   * - max 4 windows per day
   * After saving, recomputes that staff member's queue (guarded).
   */
  static async updateStaffShifts(params: {
    actorId: string;
    staffId: string;
    shifts: ShiftInput[];
  }) {
    const { actorId, staffId, shifts } = params;

    const staff = await prisma.user.findUnique({
      where: { id: staffId },
      select: { id: true, role: true },
    });

    if (!staff || staff.role !== Role.STAFF) {
      throw new AppError(404, "STAFF_NOT_FOUND", "Staff member not found");
    }

    if (!Array.isArray(shifts)) {
      throw new AppError(400, "VALIDATION_ERROR", "Shifts must be an array of shift windows");
    }

    // Group by weekday to validate bounds, counts, and overlaps
    const byWeekday = new Map<number, ShiftInput[]>();
    for (let i = 0; i <= 6; i++) {
      byWeekday.set(i, []);
    }

    for (const shift of shifts) {
      const { weekday, startMinute, endMinute } = shift;

      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        throw new AppError(400, "VALIDATION_ERROR", "Weekday must be an integer between 0 (Sunday) and 6 (Saturday)");
      }

      if (
        !Number.isInteger(startMinute) ||
        !Number.isInteger(endMinute) ||
        startMinute < 0 ||
        endMinute > 1440 ||
        startMinute >= endMinute
      ) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          `Invalid shift window [${startMinute}, ${endMinute}]. Must satisfy 0 <= start < end <= 1440.`
        );
      }

      byWeekday.get(weekday)!.push(shift);
    }

    // Check max 4 windows per day and no overlaps
    for (const [weekday, dayShifts] of byWeekday.entries()) {
      if (dayShifts.length > 4) {
        throw new AppError(
          400,
          "MAX_SHIFTS_EXCEEDED",
          `Maximum 4 shift windows allowed per day (weekday ${weekday} has ${dayShifts.length}).`
        );
      }

      if (dayShifts.length > 1) {
        dayShifts.sort((a, b) => a.startMinute - b.startMinute);
        for (let i = 0; i < dayShifts.length - 1; i++) {
          if (dayShifts[i].endMinute > dayShifts[i + 1].startMinute) {
            throw new AppError(
              400,
              "OVERLAPPING_SHIFTS",
              `Overlapping shift windows detected on weekday ${weekday}: [${dayShifts[i].startMinute}, ${dayShifts[i].endMinute}] and [${dayShifts[i + 1].startMinute}, ${dayShifts[i + 1].endMinute}].`
            );
          }
        }
      }
    }

    // Atomic replace
    await prisma.$transaction(async (tx) => {
      await tx.staffShift.deleteMany({
        where: { staffId },
      });

      if (shifts.length > 0) {
        await tx.staffShift.createMany({
          data: shifts.map((s) => ({
            staffId,
            weekday: s.weekday,
            startMinute: s.startMinute,
            endMinute: s.endMinute,
          })),
        });
      }

      await AuditService.logAction(
        {
          actorId,
          action: "UPDATE_SHIFTS",
          entityType: "USER",
          entityId: staffId,
          payload: {
            shiftCount: shifts.length,
          },
        },
        tx
      );
    });

    // Guarded post-commit recompute
    try {
      await EtaService.recomputeStaffQueue(staffId, "TICK");
    } catch (err) {
      console.error(`Guarded queue recompute failed for staff ${staffId} after shift update:`, err);
    }

    return { success: true, count: shifts.length };
  }
}
