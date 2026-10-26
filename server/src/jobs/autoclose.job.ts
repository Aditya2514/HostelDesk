import { TicketStatus, CloseReason, EventType, DisputeStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { clock } from "../lib/clock";
import { NotificationService } from "../modules/notifications/notification.service";

export interface AutoCloseJobResult {
  autoClosedCount: number;
  unableToAccessCount: number;
  totalClosedCount: number;
}

export class AutoCloseJob {
  /**
   * Evaluates tickets for automatic closing:
   * 1. 48h after RESOLVED or AWAITING_VERIFICATION without dispute:
   *    -> Sets status = CLOSED, closeReason = AUTO_CLOSED, clears completion code, logs AUTO_CLOSED event.
   * 2. 48h after AWAITING_ACCESS without occupant response:
   *    -> Sets status = CLOSED, closeReason = UNABLE_TO_ACCESS, logs STATUS_CHANGED event.
   */
  static async run(): Promise<AutoCloseJobResult> {
    const now = clock.now();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    let autoClosedCount = 0;
    let unableToAccessCount = 0;

    // -------------------------------------------------------------------------
    // 1. Auto-close resolved tickets after 48h with no open disputes
    // -------------------------------------------------------------------------
    const resolvedCandidates = await prisma.ticket.findMany({
      where: {
        status: { in: [TicketStatus.RESOLVED, TicketStatus.AWAITING_VERIFICATION] },
        resolvedAt: { lte: fortyEightHoursAgo },
        disputes: {
          none: {
            status: DisputeStatus.OPEN,
          },
        },
      },
      select: {
        id: true,
        code: true,
        status: true,
      },
    });

    for (const ticket of resolvedCandidates) {
      const previousStatus = ticket.status;
      const updated = await prisma.ticket.updateMany({
        where: {
          id: ticket.id,
          status: { in: [TicketStatus.RESOLVED, TicketStatus.AWAITING_VERIFICATION] },
        },
        data: {
          status: TicketStatus.CLOSED,
          closeReason: CloseReason.AUTO_CLOSED,
          closedAt: now,
          completionCode: null,
        },
      });

      if (updated.count > 0) {
        autoClosedCount++;

        await prisma.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            fromStatus: previousStatus,
            toStatus: TicketStatus.CLOSED,
            type: EventType.AUTO_CLOSED,
            note: "Auto-closed after 48 hours without dispute",
            createdAt: now,
          },
        });

        const audience = await NotificationService.getTicketAudience(ticket.id);
        if (audience.length > 0) {
          await NotificationService.notify(audience, {
            ticketId: ticket.id,
            type: "TICKET_AUTO_CLOSED",
            message: `Ticket ${ticket.code} was automatically closed after 48 hours with no dispute.`,
          });
        }
      }
    }

    // -------------------------------------------------------------------------
    // 2. Auto-close AWAITING_ACCESS tickets after 48h with no occupant response
    // -------------------------------------------------------------------------
    const accessCandidates = await prisma.ticket.findMany({
      where: {
        status: TicketStatus.AWAITING_ACCESS,
        pausedAt: { lte: fortyEightHoursAgo },
        disputes: {
          none: {
            status: DisputeStatus.OPEN,
          },
        },
      },
      select: {
        id: true,
        code: true,
      },
    });

    for (const ticket of accessCandidates) {
      const updated = await prisma.ticket.updateMany({
        where: {
          id: ticket.id,
          status: TicketStatus.AWAITING_ACCESS,
        },
        data: {
          status: TicketStatus.CLOSED,
          closeReason: CloseReason.UNABLE_TO_ACCESS,
          closedAt: now,
        },
      });

      if (updated.count > 0) {
        unableToAccessCount++;

        await prisma.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            fromStatus: TicketStatus.AWAITING_ACCESS,
            toStatus: TicketStatus.CLOSED,
            type: EventType.STATUS_CHANGED,
            note: "Closed: unable to access room after 48 hours with no occupant response",
            createdAt: now,
          },
        });

        const audience = await NotificationService.getTicketAudience(ticket.id);
        if (audience.length > 0) {
          await NotificationService.notify(audience, {
            ticketId: ticket.id,
            type: "TICKET_CLOSED",
            message: `Ticket ${ticket.code} closed: unable to access room after 48 hours with no response.`,
          });
        }
      }
    }

    return {
      autoClosedCount,
      unableToAccessCount,
      totalClosedCount: autoClosedCount + unableToAccessCount,
    };
  }
}
