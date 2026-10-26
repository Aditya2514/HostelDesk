import { Prisma, LocationType, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";

export interface NotificationPayload {
  ticketId?: string;
  type: string;
  message: string;
}

export class NotificationService {
  /**
   * Creates notifications for users, skipping duplicates or the actor.
   */
  static async notify(
    userIds: string[],
    payload: NotificationPayload,
    tx: Prisma.TransactionClient = prisma
  ): Promise<void> {
    const uniqueUserIds = Array.from(new Set(userIds)).filter(Boolean);
    if (uniqueUserIds.length === 0) return;

    await tx.notification.createMany({
      data: uniqueUserIds.map((userId) => ({
        userId,
        ticketId: payload.ticketId,
        type: payload.type,
        message: payload.message,
        createdAt: clock.now(),
      })),
    });
  }

  /**
   * Resolves the audience of users who should receive ticket updates:
   * - ROOM ticket: all current room occupants
   * - COMMON ticket: the raiser + followers
   * - Assigned staff (if exists)
   * - Block warden (if exists)
   * Never includes the actor who initiated the event.
   */
  static async getTicketAudience(
    ticketId: string,
    actorId?: string,
    tx: Prisma.TransactionClient = prisma
  ): Promise<string[]> {
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      include: {
        followers: { select: { userId: true } },
      },
    });

    if (!ticket) return [];

    const audienceIds = new Set<string>();

    // 1. Room occupants or common raiser + followers
    if (ticket.locationType === LocationType.ROOM && ticket.roomId) {
      const now = clock.now();
      const occupants = await tx.roomOccupancy.findMany({
        where: {
          roomId: ticket.roomId,
          fromDate: { lte: now },
          OR: [{ toDate: null }, { toDate: { gt: now } }],
        },
        select: { userId: true },
      });
      for (const occ of occupants) {
        audienceIds.add(occ.userId);
      }
    } else {
      // COMMON ticket: raiser + followers
      audienceIds.add(ticket.raisedById);
      if (ticket.followers && Array.isArray(ticket.followers)) {
        for (const f of ticket.followers) {
          audienceIds.add(f.userId);
        }
      }
    }

    // 2. Assigned staff
    if (ticket.assignedToId) {
      audienceIds.add(ticket.assignedToId);
    }

    // 3. Block warden
    if (ticket.blockId) {
      const warden = await tx.user.findFirst({
        where: {
          blockId: ticket.blockId,
          role: Role.WARDEN,
          isActive: true,
        },
        select: { id: true },
      });
      if (warden) {
        audienceIds.add(warden.id);
      }
    }

    // 4. Never notify the actor who triggered the action
    if (actorId) {
      audienceIds.delete(actorId);
    }

    return Array.from(audienceIds);
  }
}
