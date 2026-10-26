export interface SlaTicketLike {
  dueAt: Date;
  pausedAt: Date | null;
  totalPausedMinutes: number;
}

export interface SlaPauseResult {
  pausedAt: Date;
}

export interface SlaResumeResult {
  totalPausedMinutes: number;
  dueAt: Date;
  pausedAt: null;
  pausedMinutesAdded: number;
}

/**
 * Sets pausedAt = now if ticket is not already paused.
 */
export function pauseSla(ticket: SlaTicketLike, now: Date): SlaPauseResult | null {
  if (ticket.pausedAt) {
    return null; // Already paused
  }
  ticket.pausedAt = now;
  return { pausedAt: now };
}

/**
 * Resumes SLA: calculates elapsed paused minutes, adds to totalPausedMinutes,
 * moves dueAt later by the exact same amount, and clears pausedAt.
 */
export function resumeSla(ticket: SlaTicketLike, now: Date): SlaResumeResult | null {
  if (!ticket.pausedAt) {
    return null; // Not currently paused
  }
  const pausedMs = Math.max(0, now.getTime() - ticket.pausedAt.getTime());
  const pausedMinutes = Math.round(pausedMs / (60 * 1000));

  const newTotalPausedMinutes = ticket.totalPausedMinutes + pausedMinutes;
  const newDueAt = new Date(ticket.dueAt.getTime() + pausedMinutes * 60 * 1000);

  ticket.totalPausedMinutes = newTotalPausedMinutes;
  ticket.dueAt = newDueAt;
  ticket.pausedAt = null;

  return {
    totalPausedMinutes: newTotalPausedMinutes,
    dueAt: newDueAt,
    pausedAt: null,
    pausedMinutesAdded: pausedMinutes,
  };
}
