import { Prisma, LocationType, Role } from "@prisma/client";
import { AuthenticatedUser } from "../../types/express";
import { AppError } from "../../lib/errors";

export interface TicketAccessCheckable {
  id: string;
  locationType: LocationType;
  roomId?: string | null;
  blockId: string;
  raisedById: string;
  assignedToId?: string | null;
  followers?: { userId: string }[];
}

export class TicketAccessService {
  /**
   * Evaluates if a user can view a specific ticket.
   * - STUDENT: Room tickets for current room (via active occupancy), or common tickets raised/followed
   * - STAFF: Tickets assigned to them
   * - WARDEN: Tickets in their block
   * - CHIEF_WARDEN & ADMIN: All tickets
   */
  static canView(user: AuthenticatedUser, ticket: TicketAccessCheckable): boolean {
    if (user.role === Role.ADMIN || user.role === Role.CHIEF_WARDEN) {
      return true;
    }

    if (user.role === Role.WARDEN) {
      return Boolean(user.blockId && ticket.blockId === user.blockId);
    }

    if (user.role === Role.STAFF) {
      return ticket.assignedToId === user.id;
    }

    if (user.role === Role.STUDENT) {
      if (ticket.locationType === LocationType.ROOM) {
        // Room ticket belongs to the current room occupancy, not to an individual student
        return Boolean(user.currentRoomId && ticket.roomId === user.currentRoomId);
      }

      if (ticket.locationType === LocationType.COMMON) {
        if (ticket.raisedById === user.id) {
          return true;
        }
        if (ticket.followers && ticket.followers.some((f) => f.userId === user.id)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Asserts user access to a ticket. Throws 404 (not 403) so unauthorized users cannot probe ticket IDs.
   */
  static assertCanView(user: AuthenticatedUser, ticket: TicketAccessCheckable): void {
    if (!this.canView(user, ticket)) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }
  }

  /**
   * Builds the Prisma WHERE clause for list endpoints so single-ticket and list checks never disagree.
   */
  static buildListFilter(user: AuthenticatedUser): Prisma.TicketWhereInput {
    if (user.role === Role.ADMIN || user.role === Role.CHIEF_WARDEN) {
      return {};
    }

    if (user.role === Role.WARDEN) {
      return user.blockId ? { blockId: user.blockId } : { id: "none" };
    }

    if (user.role === Role.STAFF) {
      return { assignedToId: user.id };
    }

    if (user.role === Role.STUDENT) {
      const studentConditions: Prisma.TicketWhereInput[] = [
        { locationType: LocationType.COMMON, raisedById: user.id },
        { locationType: LocationType.COMMON, followers: { some: { userId: user.id } } },
      ];

      if (user.currentRoomId) {
        studentConditions.push({
          locationType: LocationType.ROOM,
          roomId: user.currentRoomId,
        });
      }

      return {
        OR: studentConditions,
      };
    }

    return { id: "none" };
  }
}
