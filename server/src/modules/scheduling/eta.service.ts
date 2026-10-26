import { Prisma, Role, TicketStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { ShiftWindow } from "./shifts";
import { simulateQueueRanges, JobDurationsInput, JobPriority } from "./simulator";
import { getDurationEstimate, EstimateResult } from "./estimator";
import { NotificationService } from "../notifications/notification.service";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Formats a Date in IST relative to 'relativeTo' Date:
 * e.g. "5:30 PM", "Tomorrow 10:00 AM", or "Tue 10:00 AM"
 */
export function formatIstTime(date: Date, relativeTo: Date): string {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  const istRel = new Date(relativeTo.getTime() + IST_OFFSET_MS);

  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  const displayMinutes = String(minutes).padStart(2, "0");
  const timeStr = `${displayHours}:${displayMinutes} ${ampm}`;

  // Check if same IST day
  const isSameDay =
    istDate.getUTCFullYear() === istRel.getUTCFullYear() &&
    istDate.getUTCMonth() === istRel.getUTCMonth() &&
    istDate.getUTCDate() === istRel.getUTCDate();

  if (isSameDay) {
    return timeStr;
  }

  // Check if tomorrow
  const tomorrowIst = new Date(istRel.getTime() + 24 * 60 * 60 * 1000);
  const isTomorrow =
    istDate.getUTCFullYear() === tomorrowIst.getUTCFullYear() &&
    istDate.getUTCMonth() === tomorrowIst.getUTCMonth() &&
    istDate.getUTCDate() === tomorrowIst.getUTCDate();

  if (isTomorrow) {
    return `Tomorrow ${timeStr}`;
  }

  const weekdayName = WEEKDAYS[istDate.getUTCDay()];
  return `${weekdayName} ${timeStr}`;
}

export class EtaService {
  /**
   * Recomputes a staff member's queue ETAs:
   * 1. Simulates that staff member's whole open queue.
   * 2. Updates etaP50At / etaP80At on each ticket (clears them for on-hold / awaiting-access tickets).
   * 3. Inserts a TicketPrediction row ONLY IF p50 changed by more than 5 minutes (no row spam).
   * 4. If the new p50 is more than 30 minutes later than etaNotifiedP50At, notifies the ticket's
   *    audience: "Your {category} fix is delayed to ~{time}: {reason}" and updates etaNotifiedP50At.
   *    When the ETA is first set, sets etaNotifiedP50At without sending a delay message.
   * 
   * Idempotent: running twice in a row without changes makes zero updates the second time.
   */
  static async recomputeStaffQueue(
    staffId: string,
    reason: string,
    client: Prisma.TransactionClient | typeof defaultPrisma = defaultPrisma
  ): Promise<void> {
    const staff = await client.user.findUnique({
      where: { id: staffId },
      include: {
        shifts: {
          select: {
            weekday: true,
            startMinute: true,
            endMinute: true,
          },
        },
      },
    });

    if (!staff || staff.shifts.length === 0) {
      return;
    }

    const openStatuses: TicketStatus[] = [
      TicketStatus.ASSIGNED,
      TicketStatus.IN_PROGRESS,
      TicketStatus.AWAITING_ACCESS,
      TicketStatus.ON_HOLD,
      TicketStatus.REOPENED,
    ];

    const openTickets = await client.ticket.findMany({
      where: {
        assignedToId: staffId,
        status: { in: openStatuses },
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            defaultDurationMin: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (openTickets.length === 0) {
      return;
    }

    const now = clock.now();
    const estimateCache = new Map<string, EstimateResult>();

    const getCachedEstimate = async (catId: string, bId?: string | null): Promise<EstimateResult> => {
      const cacheKey = `${catId}:${bId ?? "all"}`;
      if (estimateCache.has(cacheKey)) {
        return estimateCache.get(cacheKey)!;
      }
      const est = await getDurationEstimate(catId, bId, client);
      estimateCache.set(cacheKey, est);
      return est;
    };

    // Separate active tickets from paused (ON_HOLD / AWAITING_ACCESS) tickets
    const activeTickets = openTickets.filter(
      (t) => t.status !== TicketStatus.ON_HOLD && t.status !== TicketStatus.AWAITING_ACCESS
    );
    const pausedTickets = openTickets.filter(
      (t) => t.status === TicketStatus.ON_HOLD || t.status === TicketStatus.AWAITING_ACCESS
    );

    // 1. Clear ETAs for on-hold / awaiting-access tickets if currently set
    for (const ticket of pausedTickets) {
      if (ticket.etaP50At !== null || ticket.etaP80At !== null) {
        await client.ticket.update({
          where: { id: ticket.id },
          data: {
            etaP50At: null,
            etaP80At: null,
          },
        });
      }
    }

    if (activeTickets.length === 0) {
      return;
    }

    // 2. Build simulation jobs for active tickets
    const simJobs: JobDurationsInput[] = [];
    for (const t of activeTickets) {
      const est = await getCachedEstimate(t.categoryId, t.blockId);
      simJobs.push({
        ticketId: t.id,
        priority: t.priority as JobPriority,
        createdAt: t.createdAt,
        status: t.status,
        startedAt: t.startedAt,
        notBefore: t.preferredSlotStart,
        p50Minutes: est.p50Minutes,
        p80Minutes: est.p80Minutes,
      });
    }

    // 3. Simulate queue ranges
    const { p50Schedule, p80Schedule } = simulateQueueRanges({
      now,
      shifts: staff.shifts as ShiftWindow[],
      jobs: simJobs,
    });

    // 4. Update each active ticket
    for (const ticket of activeTickets) {
      const p50Result = p50Schedule.get(ticket.id);
      const p80Result = p80Schedule.get(ticket.id);

      const newP50 = p50Result ? p50Result.finishAt : null;
      const newP80 = p80Result ? p80Result.finishAt : null;

      // Determine if p50 changed by > 5 minutes
      let p50ChangedSignificantly = false;
      if (newP50 && ticket.etaP50At) {
        const diffMs = Math.abs(newP50.getTime() - ticket.etaP50At.getTime());
        if (diffMs > 5 * 60 * 1000) {
          p50ChangedSignificantly = true;
        }
      } else if (newP50 && !ticket.etaP50At) {
        // Initial setting
        p50ChangedSignificantly = true;
      }

      // Check delay notification (> 30 min later than etaNotifiedP50At)
      let updatedNotifiedP50 = ticket.etaNotifiedP50At;

      if (newP50) {
        if (!ticket.etaNotifiedP50At) {
          // When ETA is first set, set etaNotifiedP50At without sending a delay message
          updatedNotifiedP50 = newP50;
        } else {
          const delayMinutes =
            (newP50.getTime() - ticket.etaNotifiedP50At.getTime()) / (60 * 1000);

          if (delayMinutes > 30) {
            const timeStr = formatIstTime(newP50, now);
            const audience = await NotificationService.getTicketAudience(ticket.id, undefined, client);

            await NotificationService.notify(
              audience,
              {
                ticketId: ticket.id,
                type: "ETA_DELAYED",
                message: `Your ${ticket.category.name} fix is delayed to ~${timeStr}: ${reason}`,
              },
              client
            );

            updatedNotifiedP50 = newP50;
          }
        }
      }

      // Log prediction and update ticket record only if changed by > 5 minutes (or initial set)
      if (p50ChangedSignificantly) {
        await client.ticket.update({
          where: { id: ticket.id },
          data: {
            etaP50At: newP50,
            etaP80At: newP80,
            etaNotifiedP50At: updatedNotifiedP50,
          },
        });

        if (newP50) {
          await client.ticketPrediction.create({
            data: {
              ticketId: ticket.id,
              staffId,
              predictedP50At: newP50,
              predictedP80At: newP80 || newP50,
              createdAt: now,
            },
          });
        }
      } else if (!newP50 && ticket.etaP50At) {
        // Clear ETAs for on-hold or awaiting-access tickets
        await client.ticket.update({
          where: { id: ticket.id },
          data: {
            etaP50At: null,
            etaP80At: null,
          },
        });
      }
    }
  }

  /**
   * Recomputes open queues for all active staff members with shifts.
   * Used by /api/jobs/tick.
   */
  static async recomputeAllStaffQueues(reason: string): Promise<{ recomputedStaffCount: number }> {
    const activeStaff = await defaultPrisma.user.findMany({
      where: {
        role: Role.STAFF,
        isActive: true,
        shifts: { some: {} },
      },
      select: { id: true },
    });

    for (const staff of activeStaff) {
      await this.recomputeStaffQueue(staff.id, reason, defaultPrisma);
    }

    return { recomputedStaffCount: activeStaff.length };
  }
}
