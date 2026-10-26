import { Prisma, DisputeStatus, DisputeType, TicketStatus, CloseReason, ResolutionMethod, Role, EventType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { AppError } from "../../lib/errors";
import { AuthenticatedUser } from "../../types/express";
import { assertTransition } from "../tickets/stateMachine";
import { calculateActualWorkMinutes } from "../tickets/workMinutes";
import { resumeSla } from "../tickets/sla";
import { NotificationService } from "../notifications/notification.service";
import { EtaService } from "../scheduling/eta.service";
import { TX_OPTIONS } from "../tickets/tickets.service";

export class DisputesService {
  /**
   * Lists disputes for Wardens (block-scoped) or Chief Warden / Admin (hostel-wide).
   */
  static async listDisputes(user: AuthenticatedUser, statusFilter?: DisputeStatus) {
    const where: Prisma.DisputeWhereInput = {};

    if (user.role === Role.WARDEN) {
      if (!user.blockId) {
        return [];
      }
      where.ticket = { blockId: user.blockId };
    }

    if (statusFilter && Object.values(DisputeStatus).includes(statusFilter)) {
      where.status = statusFilter;
    }

    return await prisma.dispute.findMany({
      where,
      include: {
        ticket: {
          select: {
            id: true,
            code: true,
            title: true,
            status: true,
            locationType: true,
            floor: true,
            priority: true,
            blockId: true,
            block: { select: { id: true, name: true } },
            room: { select: { id: true, number: true } },
            category: { select: { id: true, name: true, trade: true } },
            raisedBy: { select: { id: true, name: true, email: true } },
            assignedTo: { select: { id: true, name: true, email: true } },
            attachments: {
              select: {
                id: true,
                url: true,
                kind: true,
                createdAt: true,
                uploader: { select: { id: true, name: true } },
              },
            },
          },
        },
        raisedBy: { select: { id: true, name: true, role: true, email: true } },
        decidedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Warden / Chief Warden / Admin decides on an OPEN dispute:
   * - CODE_REFUSED + UPHELD: transitions ticket to CLOSED with WARDEN_DECISION.
   * - LOCKED_CLAIM_FALSE + UPHELD: transitions AWAITING_ACCESS ticket back to ASSIGNED with 60-min priority boost.
   * - REJECTED: leaves ticket in current status.
   */
  static async decideDispute(
    disputeId: string,
    user: AuthenticatedUser,
    payload: { decision: "UPHELD" | "REJECTED"; note?: string }
  ) {
    if (!payload.decision || (payload.decision !== "UPHELD" && payload.decision !== "REJECTED")) {
      throw new AppError(400, "INVALID_DECISION", "Decision must be UPHELD or REJECTED");
    }

    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        ticket: {
          include: { category: true },
        },
      },
    });

    if (!dispute) {
      throw new AppError(404, "NOT_FOUND", "Dispute not found");
    }

    if (user.role === Role.WARDEN && dispute.ticket.blockId !== user.blockId) {
      throw new AppError(403, "FORBIDDEN", "Wardens can only decide disputes in their assigned block");
    }

    if (dispute.status !== DisputeStatus.OPEN) {
      throw new AppError(400, "DISPUTE_ALREADY_DECIDED", "This dispute has already been decided");
    }

    const now = clock.now();
    const decisionStatus = payload.decision === "UPHELD" ? DisputeStatus.UPHELD : DisputeStatus.REJECTED;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update dispute row
      const updatedDispute = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: decisionStatus,
          decidedById: user.id,
          decisionNote: payload.note ? payload.note.trim() : null,
          decidedAt: now,
        },
      });

      // 2. Actions per dispute type
      if (dispute.type === DisputeType.CODE_REFUSED) {
        if (payload.decision === "UPHELD") {
          assertTransition(dispute.ticket.status, TicketStatus.CLOSED, user.role);

          const statusEvents = await tx.ticketEvent.findMany({
            where: { ticketId: dispute.ticketId },
            select: { toStatus: true, fromStatus: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          });

          const actualWorkMinutes = calculateActualWorkMinutes(statusEvents, now);

          await tx.ticket.update({
            where: { id: dispute.ticketId },
            data: {
              status: TicketStatus.CLOSED,
              closeReason: CloseReason.WARDEN_DECISION,
              resolutionMethod: ResolutionMethod.WARDEN,
              resolvedAt: now,
              closedAt: now,
              actualWorkMinutes,
              completionCode: null,
              codeFailedAttempts: 0,
              codeBlockedUntil: null,
            },
          });

          await tx.ticketEvent.create({
            data: {
              ticketId: dispute.ticketId,
              actorId: user.id,
              fromStatus: dispute.ticket.status,
              toStatus: TicketStatus.CLOSED,
              type: EventType.STATUS_CHANGED,
              note: `Ticket closed by warden decision (code refusal upheld): ${payload.note || ""}`.trim(),
              createdAt: now,
            },
          });
        } else {
          await tx.ticketEvent.create({
            data: {
              ticketId: dispute.ticketId,
              actorId: user.id,
              type: EventType.DISPUTE_DECIDED,
              note: `Warden rejected code refusal dispute: ${payload.note || ""}`.trim(),
              createdAt: now,
            },
          });
        }
      } else if (dispute.type === DisputeType.LOCKED_CLAIM_FALSE) {
        if (payload.decision === "UPHELD") {
          if (dispute.ticket.status === TicketStatus.AWAITING_ACCESS) {
            const slaRes = resumeSla(dispute.ticket, now);
            const priorityBoostUntil = new Date(now.getTime() + 60 * 60 * 1000);

            await tx.ticket.update({
              where: { id: dispute.ticketId },
              data: {
                status: TicketStatus.ASSIGNED,
                priorityBoostUntil,
                pausedAt: null,
                totalPausedMinutes: slaRes ? slaRes.totalPausedMinutes : dispute.ticket.totalPausedMinutes,
                dueAt: slaRes ? slaRes.dueAt : dispute.ticket.dueAt,
              },
            });

            await tx.ticketEvent.create({
              data: {
                ticketId: dispute.ticketId,
                actorId: user.id,
                fromStatus: TicketStatus.AWAITING_ACCESS,
                toStatus: TicketStatus.ASSIGNED,
                type: EventType.STATUS_CHANGED,
                note: `False locked claim upheld by warden. Reassigned with priority boost: ${payload.note || ""}`.trim(),
                createdAt: now,
              },
            });
          }
        } else {
          await tx.ticketEvent.create({
            data: {
              ticketId: dispute.ticketId,
              actorId: user.id,
              type: EventType.DISPUTE_DECIDED,
              note: `Warden rejected false locked claim dispute: ${payload.note || ""}`.trim(),
              createdAt: now,
            },
          });
        }
      }

      // 3. Notify audience
      const audience = await NotificationService.getTicketAudience(dispute.ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId: dispute.ticketId,
          type: "DISPUTE_DECIDED",
          message: `Dispute on ${dispute.ticket.code} decided as ${payload.decision} by Warden`,
        },
        tx
      );

      return updatedDispute;
    }, TX_OPTIONS);

    // Safe queue recomputation post-commit
    if (dispute.ticket.assignedToId) {
      try {
        await EtaService.recomputeStaffQueue(dispute.ticket.assignedToId, "TICKET_RESOLVED", undefined, dispute.ticketId);
      } catch (err) {
        console.error("Queue recompute error after dispute decision:", err);
      }
    }

    return result;
  }
}
