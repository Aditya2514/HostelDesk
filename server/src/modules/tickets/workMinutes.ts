import { TicketStatus } from "@prisma/client";

export interface EventStatusChangeLike {
  toStatus?: TicketStatus | null;
  fromStatus?: TicketStatus | null;
  createdAt: Date;
}

/**
 * Computes actualWorkMinutes = the sum of all intervals the ticket spent in IN_PROGRESS,
 * from TicketEvent status changes (excluding on-hold and awaiting-access intervals).
 */
export function calculateActualWorkMinutes(
  events: EventStatusChangeLike[],
  resolvedAt: Date
): number {
  let totalMs = 0;
  let inProgressStart: Date | null = null;

  // Sort events chronologically
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const ev of sorted) {
    if (ev.toStatus === TicketStatus.IN_PROGRESS) {
      inProgressStart = ev.createdAt;
    } else if (inProgressStart && ev.fromStatus === TicketStatus.IN_PROGRESS) {
      totalMs += Math.max(0, ev.createdAt.getTime() - inProgressStart.getTime());
      inProgressStart = null;
    }
  }

  // If ticket was in progress up to the resolvedAt instant
  if (inProgressStart) {
    totalMs += Math.max(0, resolvedAt.getTime() - inProgressStart.getTime());
  }

  // Minimum 1 minute if work was marked resolved
  return Math.max(1, Math.round(totalMs / (60 * 1000)));
}
