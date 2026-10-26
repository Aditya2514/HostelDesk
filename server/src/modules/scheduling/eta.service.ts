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

/**
 * Why a staff member's queue is being recomputed.
 * Using a fixed set of reason codes (instead of free text) means the message a student
 * sees is chosen deliberately, not guessed from keywords in an internal string.
 */
export type EtaReason =
  | "NEW_TICKET" // a new ticket was routed into this queue
  | "ASSIGNED" // a warden manually assigned a ticket into this queue
  | "REASSIGNED_IN" // a ticket was moved into this queue from another staff member
  | "REASSIGNED_OUT" // a ticket was moved out of this queue
  | "PRIORITY_CHANGED" // a warden changed a ticket's priority
  | "WORK_STARTED" // the staff member started a job
  | "TICKET_RESOLVED" // a ticket was resolved and completed
  | "TICKET_DISPUTED" // a ticket was disputed and returned to queue
  | "ACCESS_RESPONDED" // occupant chose access slot or 15min boost
  | "ON_HOLD" // ticket put on hold
  | "RESUMED" // ticket resumed from hold
  | "REJECTED" // a ticket was rejected and left the queue
  | "TICK" // periodic recompute: time passed, a job may be overrunning
  | "SEED"; // synthetic data setup

/**
 * Turns a reason code into the explanation shown to the student whose ETA got later.
 * `isTriggerTicket` is true when the delayed ticket is the one the change happened to.
 */
export function studentDelayReason(reason: EtaReason, isTriggerTicket: boolean): string {
  switch (reason) {
    case "PRIORITY_CHANGED":
      return isTriggerTicket
        ? "the warden changed your ticket's priority"
        : "a more urgent issue was moved ahead of yours";
    case "NEW_TICKET":
    case "ASSIGNED":
    case "REASSIGNED_IN":
      return isTriggerTicket
        ? "your ticket was moved to a different staff member's queue"
        : "a more urgent issue was added ahead of yours";
    case "WORK_STARTED":
    case "TICK":
      return "the staff member's current job is taking longer than expected";
    default:
      return "the staff member's schedule changed";
  }
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
    reason: EtaReason,
    client: Prisma.TransactionClient | typeof defaultPrisma = defaultPrisma,
    triggerTicketId?: string
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

    // 1. Clear ETAs for on-hold / awaiting-access tickets if currently set.
    //    The notified baseline is cleared too: the student was already told why work paused,
    //    so when the ticket resumes its new ETA becomes a fresh baseline instead of
    //    immediately triggering a "delayed" message.
    for (const ticket of pausedTickets) {
      if (ticket.etaP50At !== null || ticket.etaP80At !== null || ticket.etaNotifiedP50At !== null) {
        await client.ticket.update({
          where: { id: ticket.id },
          data: {
            etaP50At: null,
            etaP80At: null,
            etaNotifiedP50At: null,
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
        priorityBoostUntil: t.priorityBoostUntil,
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
            const studentReason = studentDelayReason(reason, ticket.id === triggerTicketId);
            const audience = await NotificationService.getTicketAudience(ticket.id, undefined, client);

            await NotificationService.notify(
              audience,
              {
                ticketId: ticket.id,
                type: "ETA_DELAYED",
                message: `Your ${ticket.category.name} fix is delayed to ~${timeStr}: ${studentReason}`,
              },
              client
            );

            updatedNotifiedP50 = newP50;
          }
        }
      }

      const notifiedBaselineChanged =
        (updatedNotifiedP50?.getTime() ?? null) !== (ticket.etaNotifiedP50At?.getTime() ?? null);

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
        // Clear ETAs when the ticket can no longer be scheduled (e.g. beyond the 14-day window)
        await client.ticket.update({
          where: { id: ticket.id },
          data: {
            etaP50At: null,
            etaP80At: null,
          },
        });
      } else if (notifiedBaselineChanged) {
        // A delay message was sent although the stored ETA moved by 5 minutes or less
        // (small drifts accumulate between ticks). The baseline must still be saved,
        // otherwise every following tick would send the same "delayed" message again.
        await client.ticket.update({
          where: { id: ticket.id },
          data: { etaNotifiedP50At: updatedNotifiedP50 },
        });
      }
    }
  }

  /**
   * Recomputes open queues for all active staff members with shifts.
   * Used by /api/jobs/tick.
   */
  static async recomputeAllStaffQueues(reason: EtaReason): Promise<{ recomputedStaffCount: number }> {
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
