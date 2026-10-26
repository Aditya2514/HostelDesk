import { Role, TicketStatus, EventType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { clock } from "../lib/clock";
import { NotificationService } from "../modules/notifications/notification.service";

export interface EscalationJobResult {
  level1EscalatedCount: number;
  level2EscalatedCount: number;
  totalEscalatedCount: number;
}

const OPEN_STATUSES = [
  TicketStatus.RAISED,
  TicketStatus.ASSIGNED,
  TicketStatus.IN_PROGRESS,
  TicketStatus.AWAITING_ACCESS,
  TicketStatus.ON_HOLD,
  TicketStatus.REOPENED,
];

export class EscalationJob {
  /**
   * Evaluates all open tickets for SLA breach:
   * 1. Level 0 -> Level 1: ticket is open, not paused, clock.now() > dueAt
   *    -> Sets escalationLevel = 1, escalatedAt = now, logs ESCALATED event, notifies Block Warden.
   * 2. Level 1 -> Level 2: ticket is open, clock.now() >= escalatedAt + 24h
   *    -> Sets escalationLevel = 2, logs ESCALATED event, notifies Chief Warden.
   */
  static async run(options?: { blockId?: string }): Promise<EscalationJobResult> {
    const now = clock.now();
    let level1EscalatedCount = 0;
    let level2EscalatedCount = 0;

    // -------------------------------------------------------------------------
    // 1. Level 0 -> Level 1 Escalation (SLA breached)
    // -------------------------------------------------------------------------
    const breachedLevel0Tickets = await prisma.ticket.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        escalationLevel: 0,
        pausedAt: null, // Active SLA clock only (paused while AWAITING_ACCESS or ON_HOLD)
        dueAt: { lt: now },
        ...(options?.blockId ? { blockId: options.blockId } : {}),
      },
      select: {
        id: true,
        code: true,
        title: true,
        blockId: true,
      },
    });

    for (const ticket of breachedLevel0Tickets) {
      // Conditional update ensures idempotency across concurrent ticks
      const updated = await prisma.ticket.updateMany({
        where: {
          id: ticket.id,
          escalationLevel: 0,
        },
        data: {
          escalationLevel: 1,
          escalatedAt: now,
        },
      });

      if (updated.count > 0) {
        level1EscalatedCount++;

        // Audit event
        await prisma.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            type: EventType.ESCALATED,
            note: "SLA breached: escalated to Level 1 (Block Warden)",
            createdAt: now,
          },
        });

        // Notify Block Warden(s)
        const wardens = await prisma.user.findMany({
          where: {
            role: Role.WARDEN,
            blockId: ticket.blockId,
            isActive: true,
          },
          select: { id: true },
        });

        if (wardens.length > 0) {
          await NotificationService.notify(
            wardens.map((w) => w.id),
            {
              ticketId: ticket.id,
              type: "TICKET_ESCALATED",
              message: `Ticket ${ticket.code} ("${ticket.title}") has breached SLA and escalated to Level 1 (Block Warden).`,
            }
          );
        }
      }
    }

    // -------------------------------------------------------------------------
    // 2. Level 1 -> Level 2 Escalation (24h past Level 1 SLA breach)
    // -------------------------------------------------------------------------
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const breachedLevel1Tickets = await prisma.ticket.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        escalationLevel: 1,
        escalatedAt: { lte: twentyFourHoursAgo },
        ...(options?.blockId ? { blockId: options.blockId } : {}),
      },
      select: {
        id: true,
        code: true,
        title: true,
        blockId: true,
      },
    });

    for (const ticket of breachedLevel1Tickets) {
      // Conditional update ensures idempotency
      const updated = await prisma.ticket.updateMany({
        where: {
          id: ticket.id,
          escalationLevel: 1,
        },
        data: {
          escalationLevel: 2,
        },
      });

      if (updated.count > 0) {
        level2EscalatedCount++;

        // Audit event
        await prisma.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            type: EventType.ESCALATED,
            note: "24h unresolved after SLA breach: escalated to Level 2 (Chief Warden)",
            createdAt: now,
          },
        });

        // Notify Chief Warden(s) (with fallback to ADMIN)
        let chiefWardens = await prisma.user.findMany({
          where: {
            role: Role.CHIEF_WARDEN,
            isActive: true,
          },
          select: { id: true },
        });

        if (chiefWardens.length === 0) {
          chiefWardens = await prisma.user.findMany({
            where: {
              role: Role.ADMIN,
              isActive: true,
            },
            select: { id: true },
          });
        }

        if (chiefWardens.length > 0) {
          await NotificationService.notify(
            chiefWardens.map((cw) => cw.id),
            {
              ticketId: ticket.id,
              type: "TICKET_ESCALATED",
              message: `Ticket ${ticket.code} ("${ticket.title}") remains unresolved 24h after escalation and has escalated to Level 2 (Chief Warden).`,
            }
          );
        }
      }
    }

    return {
      level1EscalatedCount,
      level2EscalatedCount,
      totalEscalatedCount: level1EscalatedCount + level2EscalatedCount,
    };
  }

  /**
   * Non-blocking lazy check invoked when dashboards or ticket lists load.
   */
  static async runLazy(options?: { blockId?: string }): Promise<void> {
    try {
      await this.run(options);
    } catch (err) {
      console.error("[EscalationJob.runLazy] Failed non-blocking check:", err);
    }
  }
}
