import { Prisma, Role, TicketStatus, Trade, Priority } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { ShiftWindow } from "./shifts";
import { simulateQueueRanges, JobDurationsInput, JobPriority } from "./simulator";
import { getDurationEstimate, EstimateResult } from "./estimator";

export interface TicketForRouting {
  id?: string;
  categoryId: string;
  blockId?: string | null;
  floor?: number;
  priority?: Priority;
  createdAt?: Date;
  trade?: Trade;
  preferredStaffId?: string | null;
}

export interface RoutingResult {
  staffId: string;
  etaP50At: Date;
  etaP80At: Date;
  explanation: {
    estimatorOutput: EstimateResult;
    jobsAheadCount: number;
    simulatedFinishP50: Date;
    simulatedFinishP80: Date;
    activeStaffEvaluated: number;
  };
}

export class RoutingService {
  /**
   * Routes a ticket to the active staff member of the category's trade who can
   * finish it EARLIEST according to their scheduled shift windows and open queues.
   * 
   * Tie-breaker:
   *   1. Earliest simulated p50 finish
   *   2. Fewer open tickets in queue
   *   3. Lowest staff ID (lexicographical)
   * 
   * NOTE: Two tickets created at the exact same instant might both evaluate the same initial
   * queue and pick the same person. The subsequent queue recompute dynamically corrects their
   * ETAs and timeline, which is completely acceptable and robust at hostel scale.
   * 
   * Returns { staffId, etaP50At, etaP80At, explanation } or null if no staff can complete within 14 days.
   */
  static async chooseAssignee(
    ticket: TicketForRouting,
    tx: Prisma.TransactionClient | typeof defaultPrisma = defaultPrisma
  ): Promise<RoutingResult | null> {
    let trade = ticket.trade;

    if (!trade) {
      const category = await tx.category.findUnique({
        where: { id: ticket.categoryId },
        select: { trade: true },
      });
      if (!category) return null;
      trade = category.trade;
    }

    // 1. Fetch all active staff with the category's trade who have shifts
    const eligibleStaff = await tx.user.findMany({
      where: {
        role: Role.STAFF,
        trade,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        shifts: {
          select: {
            weekday: true,
            startMinute: true,
            endMinute: true,
          },
        },
      },
    });

    // Filter to staff who actually have configured shift windows
    const staffWithShifts = eligibleStaff.filter((s) => s.shifts && s.shifts.length > 0);
    if (staffWithShifts.length === 0) {
      return null;
    }

    const openStatuses: TicketStatus[] = [
      TicketStatus.ASSIGNED,
      TicketStatus.IN_PROGRESS,
      TicketStatus.AWAITING_ACCESS,
      TicketStatus.ON_HOLD,
      TicketStatus.REOPENED,
    ];

    const now = clock.now();
    const estimateCache = new Map<string, EstimateResult>();

    const getCachedEstimate = async (catId: string, bId?: string | null): Promise<EstimateResult> => {
      const cacheKey = `${catId}:${bId ?? "all"}`;
      if (estimateCache.has(cacheKey)) {
        return estimateCache.get(cacheKey)!;
      }
      const est = await getDurationEstimate(catId, bId, tx);
      estimateCache.set(cacheKey, est);
      return est;
    };

    // Preload new ticket duration estimate
    const newTicketEstimate = await getCachedEstimate(ticket.categoryId, ticket.blockId);
    const tempTicketId = ticket.id || "new-ticket-candidate";

    interface CandidateEvaluation {
      staffId: string;
      finishP50: Date;
      finishP80: Date;
      openTicketsCount: number;
      jobsAheadCount: number;
    }

    const candidates: CandidateEvaluation[] = [];

    for (const staff of staffWithShifts) {
      // Load current open queue for this staff member
      const openTickets = await tx.ticket.findMany({
        where: {
          assignedToId: staff.id,
          status: { in: openStatuses },
          ...(ticket.id ? { id: { not: ticket.id } } : {}),
        },
        select: {
          id: true,
          categoryId: true,
          blockId: true,
          priority: true,
          createdAt: true,
          status: true,
          startedAt: true,
          preferredSlotStart: true,
        },
        orderBy: { createdAt: "asc" },
      });

      // Prepare simulation jobs
      const jobsForSim: JobDurationsInput[] = [];

      for (const t of openTickets) {
        const est = await getCachedEstimate(t.categoryId, t.blockId);
        jobsForSim.push({
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

      // Add new candidate ticket
      jobsForSim.push({
        ticketId: tempTicketId,
        priority: (ticket.priority as JobPriority) || "NORMAL",
        createdAt: ticket.createdAt || now,
        status: TicketStatus.ASSIGNED,
        notBefore: null,
        p50Minutes: newTicketEstimate.p50Minutes,
        p80Minutes: newTicketEstimate.p80Minutes,
      });

      // Simulate full queue
      const { p50Schedule, p80Schedule } = simulateQueueRanges({
        now,
        shifts: staff.shifts as ShiftWindow[],
        jobs: jobsForSim,
      });

      const p50Result = p50Schedule.get(tempTicketId);
      const p80Result = p80Schedule.get(tempTicketId);

      // If cannot be scheduled within 14 days, this staff cannot take the job
      if (!p50Result || !p80Result) {
        continue;
      }

      // Count how many jobs will start before this ticket in p50 simulation
      let jobsAhead = 0;
      for (const [tId, sched] of p50Schedule.entries()) {
        if (tId !== tempTicketId && sched.startAt.getTime() < p50Result.startAt.getTime()) {
          jobsAhead++;
        }
      }

      candidates.push({
        staffId: staff.id,
        finishP50: p50Result.finishAt,
        finishP80: p80Result.finishAt,
        openTicketsCount: openTickets.length,
        jobsAheadCount: jobsAhead,
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    // Sort to pick the earliest simulated finisher
    candidates.sort((a, b) => {
      // 1. Earliest p50 finish
      const timeDiff = a.finishP50.getTime() - b.finishP50.getTime();
      if (timeDiff !== 0) return timeDiff;

      // 2. Fewer open tickets
      const loadDiff = a.openTicketsCount - b.openTicketsCount;
      if (loadDiff !== 0) return loadDiff;

      // 3. Lowest staff ID
      return a.staffId.localeCompare(b.staffId);
    });

    const preferred = ticket.preferredStaffId
      ? candidates.find((c) => c.staffId === ticket.preferredStaffId)
      : null;
    const winner = preferred || candidates[0];

    return {
      staffId: winner.staffId,
      etaP50At: winner.finishP50,
      etaP80At: winner.finishP80,
      explanation: {
        estimatorOutput: newTicketEstimate,
        jobsAheadCount: winner.jobsAheadCount,
        simulatedFinishP50: winner.finishP50,
        simulatedFinishP80: winner.finishP80,
        activeStaffEvaluated: staffWithShifts.length,
      },
    };
  }
}
