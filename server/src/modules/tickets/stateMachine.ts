import { TicketStatus, Role } from "@prisma/client";
import { AppError } from "../../lib/errors";

export type ActorRole = Role | "SYSTEM";

export interface TransitionRule {
  from: TicketStatus | null;
  to: TicketStatus;
  allowedRoles: ActorRole[];
  requiresReason?: boolean;
}

export interface TransitionContext {
  reason?: string;
  isAssignedStaff?: boolean;
  isOccupantOrReporter?: boolean;
}

// Master transition table defined in Section 5.3 of project context
export const TRANSITIONS: TransitionRule[] = [
  // Creation transitions
  { from: null, to: TicketStatus.ASSIGNED, allowedRoles: ["SYSTEM", Role.STUDENT] },
  { from: null, to: TicketStatus.RAISED, allowedRoles: ["SYSTEM", Role.STUDENT] },

  // Manual or retried assignment
  { from: TicketStatus.RAISED, to: TicketStatus.ASSIGNED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN, "SYSTEM"] },

  // Warden reassignment from open statuses
  { from: TicketStatus.ASSIGNED, to: TicketStatus.ASSIGNED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] },
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.ASSIGNED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] },
  { from: TicketStatus.ON_HOLD, to: TicketStatus.ASSIGNED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] },

  // Staff starts work
  { from: TicketStatus.ASSIGNED, to: TicketStatus.IN_PROGRESS, allowedRoles: [Role.STAFF] },

  // Locked room visits
  { from: TicketStatus.ASSIGNED, to: TicketStatus.AWAITING_ACCESS, allowedRoles: [Role.STAFF] },
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.AWAITING_ACCESS, allowedRoles: [Role.STAFF] },

  // Occupant response to locked room (rescheduling / slot choice)
  { from: TicketStatus.AWAITING_ACCESS, to: TicketStatus.ASSIGNED, allowedRoles: [Role.STUDENT, "SYSTEM"] },

  // Parts on hold
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.ON_HOLD, allowedRoles: [Role.STAFF], requiresReason: true },
  { from: TicketStatus.ON_HOLD, to: TicketStatus.IN_PROGRESS, allowedRoles: [Role.STAFF] },

  // Resolution (Phase 4 preconditions checked separately in service)
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.RESOLVED, allowedRoles: [Role.STAFF] },
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.AWAITING_VERIFICATION, allowedRoles: [Role.STAFF] },

  // Closing ticket (confirmation or auto-close)
  { from: TicketStatus.RESOLVED, to: TicketStatus.CLOSED, allowedRoles: [Role.STUDENT, "SYSTEM", Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] },
  { from: TicketStatus.AWAITING_VERIFICATION, to: TicketStatus.CLOSED, allowedRoles: [Role.STUDENT, "SYSTEM", Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] },
  { from: TicketStatus.AWAITING_ACCESS, to: TicketStatus.CLOSED, allowedRoles: ["SYSTEM"] }, // 48h unresponsive room

  // Reopening ticket (dispute within 48h, dispute-wins rule for closed tickets, or warden check)
  { from: TicketStatus.RESOLVED, to: TicketStatus.REOPENED, allowedRoles: [Role.STUDENT], requiresReason: true },
  { from: TicketStatus.AWAITING_VERIFICATION, to: TicketStatus.REOPENED, allowedRoles: [Role.STUDENT], requiresReason: true },
  { from: TicketStatus.CLOSED, to: TicketStatus.REOPENED, allowedRoles: [Role.STUDENT, Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN], requiresReason: true },

  // Warden closes ticket directly when code-refusal dispute is upheld
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.CLOSED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] },

  // Re-routed reopened ticket
  { from: TicketStatus.REOPENED, to: TicketStatus.ASSIGNED, allowedRoles: ["SYSTEM", Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] },

  // Warden rejection from any open status
  { from: TicketStatus.RAISED, to: TicketStatus.REJECTED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN], requiresReason: true },
  { from: TicketStatus.ASSIGNED, to: TicketStatus.REJECTED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN], requiresReason: true },
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.REJECTED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN], requiresReason: true },
  { from: TicketStatus.AWAITING_ACCESS, to: TicketStatus.REJECTED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN], requiresReason: true },
  { from: TicketStatus.ON_HOLD, to: TicketStatus.REJECTED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN], requiresReason: true },
  { from: TicketStatus.RESOLVED, to: TicketStatus.REJECTED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN], requiresReason: true },
  { from: TicketStatus.AWAITING_VERIFICATION, to: TicketStatus.REJECTED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN], requiresReason: true },
  { from: TicketStatus.REOPENED, to: TicketStatus.REJECTED, allowedRoles: [Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN], requiresReason: true },
];

/**
 * Validates whether a state transition is legal according to domain rules
 */
export function assertTransition(
  from: TicketStatus | null,
  to: TicketStatus,
  actorRole: ActorRole,
  context?: TransitionContext
): TransitionRule {
  const matchingRules = TRANSITIONS.filter((r) => r.from === from && r.to === to);

  if (matchingRules.length === 0) {
    throw new AppError(
      409,
      "INVALID_TRANSITION",
      `Cannot transition ticket from ${from ?? "INITIAL"} to ${to}`
    );
  }

  const authorizedRule = matchingRules.find((r) => r.allowedRoles.includes(actorRole));

  if (!authorizedRule) {
    throw new AppError(
      403,
      "FORBIDDEN_TRANSITION",
      `Role ${actorRole} is not authorized to transition ticket from ${from ?? "INITIAL"} to ${to}`
    );
  }

  if (authorizedRule.requiresReason) {
    if (!context?.reason || context.reason.trim().length === 0) {
      throw new AppError(
        400,
        "REASON_REQUIRED",
        `A valid reason is required to transition ticket from ${from} to ${to}`
      );
    }
  }

  return authorizedRule;
}
