import { ShiftWindow, addWorkingMinutes, nextWorkingInstant, workingMinutesBetween } from "./shifts";

export type JobPriority = "URGENT" | "NORMAL" | "LOW";

export interface SimulatorJob {
  ticketId: string;
  priority: JobPriority;
  createdAt: Date;
  durationMinutes: number;
  status: string; // e.g. "IN_PROGRESS", "ASSIGNED", "ON_HOLD", "AWAITING_ACCESS"
  startedAt?: Date | null;
  notBefore?: Date | null;
  priorityBoostUntil?: Date | null;
}

export interface ScheduledJobResult {
  startAt: Date;
  finishAt: Date;
}

export interface SimulatorParams {
  now: Date;
  shifts: ShiftWindow[];
  jobs: SimulatorJob[];
}

export interface JobDurationsInput {
  ticketId: string;
  priority: JobPriority;
  createdAt: Date;
  status: string;
  startedAt?: Date | null;
  notBefore?: Date | null;
  p50Minutes: number;
  p80Minutes: number;
  priorityBoostUntil?: Date | null;
}

export interface QueueRangeResult {
  p50Schedule: Map<string, ScheduledJobResult>;
  p80Schedule: Map<string, ScheduledJobResult>;
}

const PRIORITY_ORDER: Record<JobPriority, number> = {
  URGENT: 3,
  NORMAL: 2,
  LOW: 1,
};

/**
 * PURE Queue Simulator for HostelDesk.
 * 
 * Rules:
 * 1. Jobs in ON_HOLD or AWAITING_ACCESS take no staff working time and get no ETA.
 * 2. An IN_PROGRESS job goes first; its remaining work time = max(durationMinutes - minutesAlreadyWorked, 5).
 * 3. Then repeatedly choose the next job: among jobs with notBefore <= cursor (or no notBefore),
 *    pick highest priority (URGENT > NORMAL > LOW), then oldest createdAt.
 *    If no jobs are ready, jump cursor to the earliest notBefore instant.
 * 4. Lay each job into working time with addWorkingMinutes.
 */
export function simulateQueue({
  now,
  shifts,
  jobs,
}: SimulatorParams): Map<string, ScheduledJobResult> {
  const schedule = new Map<string, ScheduledJobResult>();

  if (!shifts || shifts.length === 0 || jobs.length === 0) {
    return schedule;
  }

  // 1. Filter out on-hold or awaiting-access jobs (they take no time and get no ETA)
  const activeJobs = jobs.filter(
    (j) => j.status !== "ON_HOLD" && j.status !== "AWAITING_ACCESS"
  );

  if (activeJobs.length === 0) {
    return schedule;
  }

  // Initial cursor starts at 'now'
  let cursor: Date | null = new Date(now.getTime());

  // 2. Schedule all IN_PROGRESS jobs first, oldest startedAt first
  const inProgressJobs = activeJobs.filter((j) => j.status === "IN_PROGRESS");
  inProgressJobs.sort((a, b) => {
    const aTime = a.startedAt ? a.startedAt.getTime() : a.createdAt.getTime();
    const bTime = b.startedAt ? b.startedAt.getTime() : b.createdAt.getTime();
    return aTime - bTime;
  });

  for (const inProgressJob of inProgressJobs) {
    if (!cursor) break;

    // Remaining time = max(durationMinutes - working minutes already worked within shifts, 5)
    let minutesAlreadyWorked = 0;
    if (inProgressJob.startedAt) {
      minutesAlreadyWorked = workingMinutesBetween(inProgressJob.startedAt, now, shifts);
    }
    const remainingMinutes = Math.max(
      inProgressJob.durationMinutes - minutesAlreadyWorked,
      5
    );

    const startAt = nextWorkingInstant(cursor, shifts);
    if (startAt) {
      const finishAt = addWorkingMinutes(startAt, remainingMinutes, shifts);
      if (finishAt) {
        schedule.set(inProgressJob.ticketId, { startAt, finishAt });
        cursor = finishAt;
      }
    }
  }

  let pendingJobs: SimulatorJob[] = activeJobs.filter((j) => j.status !== "IN_PROGRESS");

  // 3. Repeatedly choose next job by priority, then oldest createdAt, respecting notBefore
  while (pendingJobs.length > 0 && cursor) {
    // Jump cursor to next working instant if currently off-shift
    const workingCursor = nextWorkingInstant(cursor, shifts);
    if (!workingCursor) break;
    cursor = workingCursor;

    const currentCursor = cursor;
    // Find candidate jobs that are ready to start (notBefore <= cursor or no notBefore)
    const readyJobs = pendingJobs.filter(
      (j) => !j.notBefore || (currentCursor && j.notBefore.getTime() <= currentCursor.getTime())
    );

    if (readyJobs.length > 0) {
      // Pick boosted jobs (priorityBoostUntil > now) first, then highest priority, then oldest createdAt
      readyJobs.sort((a, b) => {
        const aBoosted = a.priorityBoostUntil && a.priorityBoostUntil.getTime() > now.getTime() ? 1 : 0;
        const bBoosted = b.priorityBoostUntil && b.priorityBoostUntil.getTime() > now.getTime() ? 1 : 0;
        if (aBoosted !== bBoosted) return bBoosted - aBoosted;

        const prioDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
        if (prioDiff !== 0) return prioDiff;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      const nextJob = readyJobs[0];
      const startAt = cursor;
      const finishAt = addWorkingMinutes(startAt, nextJob.durationMinutes, shifts);

      if (!finishAt) {
        // Exceeded maximum 14-day schedule window
        break;
      }

      schedule.set(nextJob.ticketId, { startAt, finishAt });
      cursor = finishAt;

      // Remove scheduled job from pending
      pendingJobs = pendingJobs.filter((j) => j.ticketId !== nextJob.ticketId);
    } else {
      // No jobs are ready yet: all remaining jobs have notBefore > cursor.
      // Jump cursor forward to the earliest notBefore
      const earliestNotBeforeMs = Math.min(
        ...pendingJobs.map((j) => (j.notBefore ? j.notBefore.getTime() : Infinity))
      );

      if (!isFinite(earliestNotBeforeMs)) {
        break;
      }

      cursor = new Date(earliestNotBeforeMs);
    }
  }

  return schedule;
}

/**
 * Runs queue simulation twice to compute the full ETA Range (p50 and p80):
 * - Run 1: every job simulated with its median p50 duration -> yields etaP50At
 * - Run 2: every job simulated with its upper 80th-percentile p80 duration -> yields etaP80At
 * 
 * Running both full simulations accurately accounts for queue queuing delays:
 * if earlier jobs take their p80 duration, subsequent jobs are pushed back accordingly.
 * This guarantees that etaP80At is an honest, realistic conservative bound for the occupant.
 */
export function simulateQueueRanges({
  now,
  shifts,
  jobs,
}: {
  now: Date;
  shifts: ShiftWindow[];
  jobs: JobDurationsInput[];
}): QueueRangeResult {
  // 1. Simulation with p50 durations
  const p50Jobs: SimulatorJob[] = jobs.map((j) => ({
    ticketId: j.ticketId,
    priority: j.priority,
    createdAt: j.createdAt,
    durationMinutes: j.p50Minutes,
    status: j.status,
    startedAt: j.startedAt,
    notBefore: j.notBefore,
    priorityBoostUntil: j.priorityBoostUntil,
  }));
  const p50Schedule = simulateQueue({ now, shifts, jobs: p50Jobs });

  // 2. Simulation with p80 durations
  const p80Jobs: SimulatorJob[] = jobs.map((j) => ({
    ticketId: j.ticketId,
    priority: j.priority,
    createdAt: j.createdAt,
    durationMinutes: j.p80Minutes,
    status: j.status,
    startedAt: j.startedAt,
    notBefore: j.notBefore,
    priorityBoostUntil: j.priorityBoostUntil,
  }));
  const p80Schedule = simulateQueue({ now, shifts, jobs: p80Jobs });

  return { p50Schedule, p80Schedule };
}
