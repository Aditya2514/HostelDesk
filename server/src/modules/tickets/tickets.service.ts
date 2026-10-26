import crypto from "crypto";
import {
  Prisma,
  LocationType,
  Priority,
  TicketStatus,
  Role,
  ResolutionMethod,
  AttachmentKind,
  EventType,
  CloseReason,
  DisputeType,
  DisputeStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { AppError } from "../../lib/errors";
import { AuthenticatedUser } from "../../types/express";
import { RoutingService } from "../scheduling/routing.service";
import { EtaService, EtaReason } from "../scheduling/eta.service";
import { getDurationEstimate, EstimateResult } from "../scheduling/estimator";
import { simulateQueueRanges, JobDurationsInput, JobPriority } from "../scheduling/simulator";
import { ShiftWindow, toIstParts, fromIstParts } from "../scheduling/shifts";
import { NotificationService } from "../notifications/notification.service";
import { TicketAccessService } from "./ticketAccess.service";
import { assertTransition } from "./stateMachine";
import { calculateActualWorkMinutes } from "./workMinutes";
import { pauseSla, resumeSla } from "./sla";

export const OPEN_STATUSES: TicketStatus[] = [
  TicketStatus.RAISED,
  TicketStatus.ASSIGNED,
  TicketStatus.IN_PROGRESS,
  TicketStatus.AWAITING_ACCESS,
  TicketStatus.ON_HOLD,
  TicketStatus.REOPENED,
];

export const TX_OPTIONS = { timeout: 15000, maxWait: 10000 };

export class TicketsService {
  /**
   * Safely recomputes staff queue after transaction commit, logging errors
   * without failing the parent request.
   */
  private static async safeRecomputeStaffQueue(
    staffId: string,
    reason: EtaReason,
    triggerTicketId?: string
  ): Promise<void> {
    try {
      await EtaService.recomputeStaffQueue(staffId, reason, undefined, triggerTicketId);
    } catch (err) {
      console.error(`[EtaService] Post-commit queue recompute failed for staff ${staffId} (${reason}):`, err);
    }
  }

  /**
   * Generates a 4-digit completion code for ROOM tickets entering IN_PROGRESS,
   * zero-padded via crypto.randomInt(0, 10000). Resets failed attempts and blocks.
   */
  static async onEnterInProgress(ticketId: string, tx: Prisma.TransactionClient): Promise<void> {
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: { locationType: true },
    });

    if (ticket?.locationType === LocationType.ROOM) {
      const code = String(crypto.randomInt(0, 10000)).padStart(4, "0");
      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          completionCode: code,
          codeFailedAttempts: 0,
          codeBlockedUntil: null,
        },
      });
    } else {
      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          completionCode: null,
          codeFailedAttempts: 0,
          codeBlockedUntil: null,
        },
      });
    }
  }

  /**
   * Creates a ticket for a room or common area with duplicate handling
   */
  static async createTicket(
    user: AuthenticatedUser,
    data: {
      locationType: LocationType;
      categoryId: string;
      title: string;
      description: string;
      floor?: number;
      commonSpot?: string;
      joinExistingCheck?: boolean;
    }
  ) {
    if (user.role !== Role.STUDENT) {
      throw new AppError(403, "FORBIDDEN", "Only students can raise complaint tickets");
    }

    const now = clock.now();

    // 1. Fetch category and validate
    const category = await prisma.category.findUnique({
      where: { id: data.categoryId },
    });
    if (!category || !category.isActive) {
      throw new AppError(400, "INVALID_CATEGORY", "Invalid or inactive category selected");
    }

    let roomId: string | null = null;
    let blockId: string;
    let floor: number;
    let commonSpot: string | null = null;

    if (data.locationType === LocationType.ROOM) {
      // Room comes strictly from student's current occupancy (never from body)
      const currentOccupancy = await prisma.roomOccupancy.findFirst({
        where: {
          userId: user.id,
          fromDate: { lte: now },
          OR: [{ toDate: null }, { toDate: { gt: now } }],
        },
        include: {
          room: true,
        },
        orderBy: { fromDate: "desc" },
      });

      if (!currentOccupancy) {
        throw new AppError(400, "NO_CURRENT_ROOM", "You do not have an active room assignment");
      }

      roomId = currentOccupancy.roomId;
      blockId = currentOccupancy.room.blockId;
      floor = currentOccupancy.room.floor;

      // Duplicate check: Same room + category has an open ticket
      const existingOpenRoomTicket = await prisma.ticket.findFirst({
        where: {
          roomId,
          categoryId: category.id,
          status: { in: OPEN_STATUSES },
        },
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
        },
      });

      if (existingOpenRoomTicket) {
        throw new AppError(
          409,
          "DUPLICATE_ROOM_TICKET",
          `Your roommate already reported an active ticket (${existingOpenRoomTicket.code}) for this issue.`,
          {
            existingTicketId: existingOpenRoomTicket.id,
            existingTicketCode: existingOpenRoomTicket.code,
          }
        );
      }
    } else {
      // Common area ticket
      floor = data.floor!;
      commonSpot = data.commonSpot!;

      // Determine student's block from active room occupancy
      const userWithRoom = await prisma.roomOccupancy.findFirst({
        where: {
          userId: user.id,
          fromDate: { lte: now },
          OR: [{ toDate: null }, { toDate: { gt: now } }],
        },
        include: { room: true },
      });

      if (!userWithRoom) {
        throw new AppError(
          400,
          "NO_CURRENT_ROOM",
          "You must have an active room assignment to report common area complaints"
        );
      }

      blockId = userWithRoom.room.blockId;

      // Similar common-area tickets in last 2 hours
      if (data.joinExistingCheck !== false) {
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        const similarTickets = await prisma.ticket.findMany({
          where: {
            locationType: LocationType.COMMON,
            blockId,
            floor,
            categoryId: category.id,
            status: { in: OPEN_STATUSES },
            createdAt: { gte: twoHoursAgo },
          },
          include: {
            _count: { select: { followers: true } },
          },
        });

        if (similarTickets.length > 0) {
          const formattedSimilar = similarTickets.map((t) => ({
            id: t.id,
            code: t.code,
            title: t.title,
            commonSpot: t.commonSpot,
            followerCount: t._count.followers,
            createdAt: t.createdAt,
          }));

          throw new AppError(
            409,
            "SIMILAR_TICKETS_EXIST",
            "Similar common area issues have recently been reported on this floor.",
            {
              similarTickets: formattedSimilar,
            }
          );
        }
      }
    }

    const priority = category.defaultPriority;
    const dueAt = new Date(now.getTime() + category.slaMinutes * 60 * 1000);

    // 1. Compute routing BEFORE transaction (read-only queries across candidate staff)
    const routingResult = await RoutingService.chooseAssignee({
      categoryId: category.id,
      blockId,
      floor,
      priority,
      createdAt: now,
      trade: category.trade,
    });

    const assignedStaffId = routingResult?.staffId ?? null;
    const initialStatus = assignedStaffId ? TicketStatus.ASSIGNED : TicketStatus.RAISED;

    // 2. Run ticket creation in transaction with explicit timeout options
    const result = await prisma.$transaction(async (tx) => {
      // Temporary placeholder code until autoincrement number is returned
      const tempCode = `HD-TMP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      const createdTicket = await tx.ticket.create({
        data: {
          code: tempCode,
          locationType: data.locationType,
          roomId,
          blockId,
          floor,
          commonSpot,
          categoryId: category.id,
          priority,
          title: data.title,
          description: data.description,
          status: initialStatus,
          assignedToId: assignedStaffId,
          raisedById: user.id,
          dueAt,
          createdAt: now,
          etaP50At: routingResult?.etaP50At ?? null,
          etaP80At: routingResult?.etaP80At ?? null,
          etaNotifiedP50At: routingResult?.etaP50At ?? null,
        },
      });

      // Format human-readable ticket code e.g. HD-0001
      const formattedCode = `HD-${String(createdTicket.number).padStart(4, "0")}`;

      const updatedTicket = await tx.ticket.update({
        where: { id: createdTicket.id },
        data: { code: formattedCode },
      });

      if (routingResult) {
        await tx.ticketPrediction.create({
          data: {
            ticketId: updatedTicket.id,
            staffId: routingResult.staffId,
            predictedP50At: routingResult.etaP50At,
            predictedP80At: routingResult.etaP80At,
            createdAt: now,
          },
        });
      } else {
        // Ticket stays RAISED and warden is notified
        const warden = await tx.user.findFirst({
          where: { role: Role.WARDEN, blockId, isActive: true },
        });
        if (warden) {
          await NotificationService.notify(
            [warden.id],
            {
              ticketId: updatedTicket.id,
              type: "NO_STAFF_AVAILABLE",
              message: `Ticket ${formattedCode} requires manual assignment: no staff shift available within 14 days.`,
            },
            tx
          );
        }
      }

      // 4. Record event timeline
      await tx.ticketEvent.create({
        data: {
          ticketId: updatedTicket.id,
          actorId: user.id,
          type: "CREATED",
          note: `Ticket created for ${data.locationType === LocationType.ROOM ? "room" : "common area"} (${category.name})`,
          createdAt: now,
        },
      });

      if (assignedStaffId) {
        await tx.ticketEvent.create({
          data: {
            ticketId: updatedTicket.id,
            actorId: null,
            fromStatus: null,
            toStatus: TicketStatus.ASSIGNED,
            type: "ASSIGNED",
            note: "Automatically assigned to trade staff",
            createdAt: now,
          },
        });
      }

      // 5. Send notifications
      const audience = await NotificationService.getTicketAudience(updatedTicket.id, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId: updatedTicket.id,
          type: "TICKET_CREATED",
          message: `New ticket ${formattedCode}: ${data.title}`,
        },
        tx
      );

      return updatedTicket;
    }, TX_OPTIONS);

    if (result.assignedToId) {
      await this.safeRecomputeStaffQueue(result.assignedToId, "NEW_TICKET", result.id);
    }

    return result;
  }

  /**
   * Follow a common area ticket
   */
  static async followTicket(ticketId: string, user: AuthenticatedUser) {
    if (user.role !== Role.STUDENT) {
      throw new AppError(403, "FORBIDDEN", "Only students can join common area tickets");
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { _count: { select: { followers: true } } },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (ticket.locationType !== LocationType.COMMON) {
      throw new AppError(400, "BAD_REQUEST", "Only common-area tickets can be joined");
    }

    if (!OPEN_STATUSES.includes(ticket.status)) {
      throw new AppError(400, "TICKET_NOT_OPEN", "This ticket is no longer open for joining");
    }

    const now = clock.now();

    // Verify student has an active room and belongs to the same block
    const occupancy = await prisma.roomOccupancy.findFirst({
      where: {
        userId: user.id,
        fromDate: { lte: now },
        OR: [{ toDate: null }, { toDate: { gt: now } }],
      },
      include: { room: true },
    });

    if (!occupancy) {
      throw new AppError(400, "NO_CURRENT_ROOM", "You must have an active room assignment to join complaints");
    }

    if (ticket.blockId !== occupancy.room.blockId) {
      throw new AppError(403, "FORBIDDEN", "You can only join common-area complaints in your assigned block");
    }

    return await prisma.$transaction(async (tx) => {
      // Upsert follower relation (idempotent)
      await tx.ticketFollower.upsert({
        where: {
          ticketId_userId: {
            ticketId,
            userId: user.id,
          },
        },
        create: {
          ticketId,
          userId: user.id,
          createdAt: now,
        },
        update: {},
      });

      const updatedCount = await tx.ticketFollower.count({ where: { ticketId } });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          type: "FOLLOWED",
          note: `${user.name} joined this complaint (${updatedCount} students now report this)`,
          createdAt: now,
        },
      });

      // Notify the original raiser
      if (ticket.raisedById !== user.id) {
        await NotificationService.notify(
          [ticket.raisedById],
          {
            ticketId,
            type: "TICKET_JOINED",
            message: `${updatedCount} students now report your issue: ${ticket.title}`,
          },
          tx
        );
      }

      return { success: true, followerCount: updatedCount };
    }, TX_OPTIONS);
  }

  /**
   * Staff starts work on an assigned ticket
   */
  static async startWork(ticketId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (ticket.assignedToId !== user.id) {
      throw new AppError(403, "FORBIDDEN", "You are not assigned to this ticket");
    }

    assertTransition(ticket.status, TicketStatus.IN_PROGRESS, user.role);

    const now = clock.now();

    const res = await prisma.$transaction(async (tx) => {
      // Concurrency check: conditional update
      const updated = await tx.ticket.updateMany({
        where: {
          id: ticketId,
          status: ticket.status,
        },
        data: {
          status: TicketStatus.IN_PROGRESS,
          startedAt: now,
        },
      });

      if (updated.count === 0) {
        throw new AppError(409, "TICKET_CHANGED", "This ticket was modified by another operation. Please refresh.");
      }

      await this.onEnterInProgress(ticketId, tx);

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: ticket.status,
          toStatus: TicketStatus.IN_PROGRESS,
          type: "STATUS_CHANGED",
          note: "Staff started work on site",
          createdAt: now,
        },
      });

      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "WORK_STARTED",
          message: `Work started on ${ticket.code}: ${ticket.title}`,
        },
        tx
      );

      return { success: true, status: TicketStatus.IN_PROGRESS };
    }, TX_OPTIONS);

    if (ticket.assignedToId) {
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "WORK_STARTED", ticketId);
    }

    return res;
  }

  /**
   * Resolves a ticket by assigned staff:
   * - Requires at least one AFTER photo uploaded by this staff member since latest IN_PROGRESS start.
   * - ROOM tickets: requires completion code, row-locked verification, 5 attempts max with 15 min lock.
   * - COMMON tickets: resolves to AWAITING_VERIFICATION via PHOTO.
   * - Computes actualWorkMinutes across active IN_PROGRESS intervals.
   */
  static async resolveTicket(ticketId: string, user: AuthenticatedUser, code?: string) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        category: { select: { id: true, name: true } },
      },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (ticket.assignedToId !== user.id && user.role !== Role.ADMIN) {
      throw new AppError(403, "FORBIDDEN", "Only the assigned staff member can resolve this ticket");
    }

    if (ticket.status !== TicketStatus.IN_PROGRESS) {
      throw new AppError(400, "TICKET_NOT_IN_PROGRESS", "Ticket must be in progress to be marked resolved");
    }

    const now = clock.now();

    const targetStatus =
      ticket.locationType === LocationType.ROOM
        ? TicketStatus.RESOLVED
        : TicketStatus.AWAITING_VERIFICATION;

    const resolutionMethod =
      ticket.locationType === LocationType.ROOM
        ? ResolutionMethod.CODE
        : ResolutionMethod.PHOTO;

    assertTransition(ticket.status, targetStatus, user.role);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Verify AFTER photo was uploaded by this staff member since latest startedAt
      const afterPhoto = await tx.attachment.findFirst({
        where: {
          ticketId: ticket.id,
          kind: AttachmentKind.AFTER,
          uploaderId: user.id,
          createdAt: {
            gte: ticket.startedAt ?? new Date(0),
          },
        },
      });

      if (!afterPhoto) {
        throw new AppError(400, "AFTER_PHOTO_REQUIRED", "At least one AFTER photo is required to resolve this ticket");
      }

      // 2. Row-locked fetch to prevent parallel code guessing races
      const [lockedTicket] = await tx.$queryRaw<Array<{
        id: string;
        completionCode: string | null;
        codeFailedAttempts: number;
        codeBlockedUntil: Date | null;
        status: TicketStatus;
        locationType: LocationType;
      }>>`SELECT id, "completionCode", "codeFailedAttempts", "codeBlockedUntil", status, "locationType" FROM tickets WHERE id = ${ticketId} FOR UPDATE`;

      if (!lockedTicket) {
        throw new AppError(404, "NOT_FOUND", "Ticket not found");
      }

      // Check lock state
      if (lockedTicket.codeBlockedUntil && lockedTicket.codeBlockedUntil.getTime() > now.getTime()) {
        const minutesLeft = Math.ceil((lockedTicket.codeBlockedUntil.getTime() - now.getTime()) / 60000);
        throw new AppError(
          429,
          "CODE_LOCKED",
          `Too many attempts. Try again in ${minutesLeft} minute${minutesLeft > 1 ? "s" : ""}.`
        );
      }

      // 3. For ROOM tickets: verify code
      if (ticket.locationType === LocationType.ROOM) {
        const inputCode = code ? String(code).trim() : "";
        if (!inputCode) {
          throw new AppError(400, "CODE_REQUIRED", "Completion code is required for room tickets");
        }

        if (inputCode !== lockedTicket.completionCode) {
          const newFailedCount = (lockedTicket.codeFailedAttempts || 0) + 1;
          let blockedUntil: Date | null = null;
          let resetCount = newFailedCount;

          if (newFailedCount >= 5) {
            blockedUntil = new Date(now.getTime() + 15 * 60 * 1000);
            resetCount = 0; // Reset counter after locking
          }

          await tx.ticket.update({
            where: { id: ticketId },
            data: {
              codeFailedAttempts: resetCount,
              codeBlockedUntil: blockedUntil,
            },
          });

          await tx.ticketEvent.create({
            data: {
              ticketId,
              actorId: user.id,
              type: EventType.CODE_FAILED,
              note: `Invalid completion code attempt (${newFailedCount}/5)`,
              createdAt: now,
            },
          });

          if (newFailedCount >= 5) {
            throw new AppError(429, "CODE_LOCKED", "Too many attempts. Try again in 15 minutes.");
          }

          throw new AppError(
            400,
            "INVALID_CODE",
            `Invalid completion code. ${5 - newFailedCount} attempt(s) remaining.`
          );
        }

        // Correct code: log CODE_VERIFIED event
        await tx.ticketEvent.create({
          data: {
            ticketId,
            actorId: user.id,
            type: EventType.CODE_VERIFIED,
            note: "Completion code verified with occupant",
            createdAt: now,
          },
        });
      }

      // 4. Compute actualWorkMinutes across all IN_PROGRESS intervals
      const statusEvents = await tx.ticketEvent.findMany({
        where: { ticketId },
        select: { toStatus: true, fromStatus: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      const actualWorkMinutes = calculateActualWorkMinutes(statusEvents, now);

      // 5. Update ticket to resolved state & clear completionCode
      const updatedTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: targetStatus,
          resolutionMethod,
          resolvedAt: now,
          actualWorkMinutes,
          completionCode: null,
          codeFailedAttempts: 0,
          codeBlockedUntil: null,
        },
      });

      // 6. Record STATUS_CHANGED timeline event
      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: TicketStatus.IN_PROGRESS,
          toStatus: targetStatus,
          type: EventType.STATUS_CHANGED,
          note: `Marked fixed via ${resolutionMethod} (${actualWorkMinutes} working minutes logged)`,
          createdAt: now,
        },
      });

      // 7. Notify audience
      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "TICKET_RESOLVED",
          message: `Your ${ticket.category.name} issue was marked fixed. Please confirm or report a problem within 48 hours.`,
        },
        tx
      );

      return updatedTicket;
    }, TX_OPTIONS);

    // Recompute staff queue post-commit
    if (ticket.assignedToId) {
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "TICKET_RESOLVED", ticketId);
    }

    return result;
  }

  /**
   * Helper verifying that a student is either a current occupant of the room
   * (for ROOM tickets) or raiser/follower (for COMMON tickets).
   */
  private static async verifyStudentOccupantOrFollower(
    ticket: {
      id: string;
      locationType: LocationType;
      roomId?: string | null;
      raisedById: string;
    },
    user: AuthenticatedUser,
    tx: Prisma.TransactionClient = prisma
  ): Promise<void> {
    if (user.role === Role.ADMIN) return;

    if (ticket.locationType === LocationType.ROOM && ticket.roomId) {
      if (user.currentRoomId && user.currentRoomId === ticket.roomId) {
        return;
      }
      const occ = await tx.roomOccupancy.findFirst({
        where: {
          roomId: ticket.roomId,
          userId: user.id,
          OR: [{ toDate: null }, { toDate: { gte: clock.now() } }],
        },
      });
      if (occ || ticket.raisedById === user.id) {
        return;
      }
    } else {
      // COMMON: raiser or follower
      if (ticket.raisedById === user.id) {
        return;
      }
      const follower = await tx.ticketFollower.findUnique({
        where: { ticketId_userId: { ticketId: ticket.id, userId: user.id } },
      });
      if (follower) {
        return;
      }
    }

    throw new AppError(403, "FORBIDDEN", "Only room occupants or ticket reporters can perform this action");
  }

  /**
   * Confirms resolution of a ticket by student (occupant or reporter).
   * Transitions ticket to CLOSED with closeReason CONFIRMED.
   */
  static async confirmTicket(ticketId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    await this.verifyStudentOccupantOrFollower(ticket, user);

    if (ticket.status === TicketStatus.CLOSED && ticket.closeReason === CloseReason.CONFIRMED) {
      return { success: true, status: TicketStatus.CLOSED, closeReason: CloseReason.CONFIRMED };
    }

    assertTransition(ticket.status, TicketStatus.CLOSED, user.role);

    const now = clock.now();

    const result = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{
        id: string;
        status: TicketStatus;
        closeReason: CloseReason | null;
      }>>`SELECT id, status, "closeReason" FROM tickets WHERE id = ${ticketId} FOR UPDATE`;

      if (!locked) {
        throw new AppError(404, "NOT_FOUND", "Ticket not found");
      }

      if (locked.status === TicketStatus.CLOSED && locked.closeReason === CloseReason.CONFIRMED) {
        return { success: true, status: TicketStatus.CLOSED, closeReason: CloseReason.CONFIRMED };
      }

      if (
        locked.status !== TicketStatus.RESOLVED &&
        locked.status !== TicketStatus.AWAITING_VERIFICATION
      ) {
        throw new AppError(409, "INVALID_STATE", `Cannot confirm ticket with status ${locked.status}`);
      }

      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.CLOSED,
          closeReason: CloseReason.CONFIRMED,
          closedAt: now,
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: locked.status,
          toStatus: TicketStatus.CLOSED,
          type: EventType.CONFIRMED,
          note: "Resolution confirmed by student",
          createdAt: now,
        },
      });

      // Also close grouped child tickets if this was a parent ticket
      await tx.ticket.updateMany({
        where: {
          parentTicketId: ticketId,
          status: { in: [TicketStatus.RESOLVED, TicketStatus.AWAITING_VERIFICATION] },
        },
        data: {
          status: TicketStatus.CLOSED,
          closeReason: CloseReason.CONFIRMED,
          closedAt: now,
        },
      });

      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "TICKET_CONFIRMED",
          message: `${ticket.code} was confirmed and closed.`,
        },
        tx
      );

      return { success: true, status: updated.status, closeReason: updated.closeReason };
    }, TX_OPTIONS);

    return result;
  }

  /**
   * Disputes resolution of a ticket within 48 hours of resolvedAt.
   * Disputing always wins over confirmation within 48h.
   * Reopens the ticket, increments reopenCount, logs Dispute row, and re-routes.
   */
  static async disputeTicket(ticketId: string, user: AuthenticatedUser, reason: string) {
    if (!reason || !reason.trim()) {
      throw new AppError(400, "REASON_REQUIRED", "Dispute reason is required");
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    await this.verifyStudentOccupantOrFollower(ticket, user);

    const now = clock.now();
    const disputeWindowMs = 48 * 60 * 60 * 1000;

    if (!ticket.resolvedAt) {
      throw new AppError(400, "TICKET_NOT_RESOLVED", "Ticket has not been marked resolved");
    }
    if (now.getTime() - ticket.resolvedAt.getTime() > disputeWindowMs) {
      throw new AppError(409, "DISPUTE_WINDOW_CLOSED", "Dispute window has closed (48 hours after resolution)");
    }

    let oldAssignedStaffId: string | null = null;
    let newAssignedStaffId: string | null = null;

    const result = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{
        id: string;
        status: TicketStatus;
        closeReason: CloseReason | null;
        resolvedAt: Date | null;
        reopenCount: number;
        assignedToId: string | null;
        categoryId: string;
        blockId: string;
        priority: Priority;
        createdAt: Date;
      }>>`SELECT id, status, "closeReason", "resolvedAt", "reopenCount", "assignedToId", "categoryId", "blockId", priority, "createdAt" FROM tickets WHERE id = ${ticketId} FOR UPDATE`;

      if (!locked) {
        throw new AppError(404, "NOT_FOUND", "Ticket not found");
      }

      if (!locked.resolvedAt || now.getTime() - locked.resolvedAt.getTime() > disputeWindowMs) {
        throw new AppError(409, "DISPUTE_WINDOW_CLOSED", "Dispute window has closed (48 hours after resolution)");
      }

      const allowed =
        locked.status === TicketStatus.RESOLVED ||
        locked.status === TicketStatus.AWAITING_VERIFICATION ||
        (locked.status === TicketStatus.CLOSED &&
          (locked.closeReason === CloseReason.CONFIRMED || locked.closeReason === CloseReason.AUTO_CLOSED));

      if (!allowed) {
        if (locked.status === TicketStatus.REOPENED || locked.status === TicketStatus.ASSIGNED) {
          return { success: true, status: locked.status, reopenCount: locked.reopenCount };
        }
        throw new AppError(409, "INVALID_STATE", `Cannot dispute ticket with status ${locked.status}`);
      }

      oldAssignedStaffId = locked.assignedToId;

      // 1. Create Dispute entry
      const dispute = await tx.dispute.create({
        data: {
          ticketId,
          raisedById: user.id,
          type: DisputeType.FIX_NOT_DONE,
          reason: reason.trim(),
          status: DisputeStatus.UPHELD,
          createdAt: now,
        },
      });

      // 2. Log DISPUTED event
      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          type: EventType.DISPUTED,
          note: `Fix disputed: ${reason.trim()}`,
          createdAt: now,
        },
      });

      // 3. Increment reopenCount
      const nextReopenCount = (locked.reopenCount || 0) + 1;

      // 4. Update status to REOPENED
      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.REOPENED,
          reopenCount: nextReopenCount,
          resolvedAt: null,
          closedAt: null,
          closeReason: null,
          startedAt: null,
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: locked.status,
          toStatus: TicketStatus.REOPENED,
          type: EventType.STATUS_CHANGED,
          note: `Ticket reopened via dispute (reopen count: ${nextReopenCount})`,
          createdAt: now,
        },
      });

      // 5. Re-route ticket (preferred same staff if available)
      const route = await RoutingService.chooseAssignee(
        {
          id: ticketId,
          categoryId: locked.categoryId,
          blockId: locked.blockId,
          priority: locked.priority,
          createdAt: locked.createdAt,
          preferredStaffId: locked.assignedToId,
        },
        tx
      );

      let finalStatus = TicketStatus.REOPENED;

      if (route) {
        finalStatus = TicketStatus.ASSIGNED;
        newAssignedStaffId = route.staffId;

        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            status: TicketStatus.ASSIGNED,
            assignedToId: route.staffId,
            etaP50At: route.etaP50At,
            etaP80At: route.etaP80At,
          },
        });

        await tx.ticketEvent.create({
          data: {
            ticketId,
            actorId: user.id,
            fromStatus: TicketStatus.REOPENED,
            toStatus: TicketStatus.ASSIGNED,
            type: EventType.STATUS_CHANGED,
            note: `Reassigned to staff ${route.staffId}`,
            createdAt: now,
          },
        });
      } else {
        finalStatus = TicketStatus.RAISED;
        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            status: TicketStatus.RAISED,
            assignedToId: null,
            etaP50At: null,
            etaP80At: null,
          },
        });
      }

      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "TICKET_DISPUTED",
          message: `Ticket disputed by occupant: ${reason.trim()}`,
        },
        tx
      );

      return {
        success: true,
        status: finalStatus,
        reopenCount: nextReopenCount,
        assignedToId: newAssignedStaffId,
        disputeId: dispute.id,
      };
    }, TX_OPTIONS);

    // Safe queue recomputations post-commit
    if (oldAssignedStaffId) {
      await this.safeRecomputeStaffQueue(oldAssignedStaffId, "TICKET_DISPUTED", ticketId);
    }
    if (newAssignedStaffId && newAssignedStaffId !== oldAssignedStaffId) {
      await this.safeRecomputeStaffQueue(newAssignedStaffId, "TICKET_DISPUTED", ticketId);
    }

    return result;
  }

  /**
   * Assigned staff reports that room was locked.
   * Requires DOOR photo uploaded by staff within the last 30 minutes.
   * Increments lockedVisitCount, transitions to AWAITING_ACCESS, pauses SLA, notifies occupants.
   */
  static async reportRoomLocked(ticketId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (ticket.assignedToId !== user.id && user.role !== Role.ADMIN) {
      throw new AppError(403, "FORBIDDEN", "Only the assigned staff member can report room locked");
    }

    if (ticket.locationType !== LocationType.ROOM) {
      throw new AppError(400, "ROOM_ONLY", "Room locked report is only applicable to room tickets");
    }

    if (ticket.status !== TicketStatus.ASSIGNED && ticket.status !== TicketStatus.IN_PROGRESS) {
      throw new AppError(400, "INVALID_STATE", `Cannot report room locked for ticket in ${ticket.status}`);
    }

    assertTransition(ticket.status, TicketStatus.AWAITING_ACCESS, user.role);

    const now = clock.now();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);

    // Verify door photo uploaded by this staff member within the last 30 minutes
    const doorPhoto = await prisma.attachment.findFirst({
      where: {
        ticketId,
        kind: AttachmentKind.DOOR,
        uploaderId: user.id,
        createdAt: { gte: thirtyMinAgo },
      },
    });

    if (!doorPhoto) {
      throw new AppError(
        400,
        "DOOR_PHOTO_REQUIRED",
        "A door photo uploaded within the last 30 minutes is required to mark room locked"
      );
    }

    const newLockedCount = (ticket.lockedVisitCount || 0) + 1;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Pause SLA
      pauseSla(ticket, now);

      // 2. Update ticket
      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.AWAITING_ACCESS,
          lockedVisitCount: newLockedCount,
          pausedAt: now,
          etaP50At: null,
          etaP80At: null,
          etaNotifiedP50At: null,
        },
      });

      // 3. Log event
      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: ticket.status,
          toStatus: TicketStatus.AWAITING_ACCESS,
          type: EventType.ROOM_LOCKED,
          note: `Staff reported room was locked (visit #${newLockedCount}) with door photo`,
          createdAt: now,
        },
      });

      // 4. Notify room occupants
      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "ROOM_LOCKED",
          message: `${user.name} came at ${timeStr}; your room was locked.`,
        },
        tx
      );

      return {
        success: true,
        status: updated.status,
        lockedVisitCount: updated.lockedVisitCount,
      };
    }, TX_OPTIONS);

    if (ticket.assignedToId) {
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "ROOM_LOCKED", ticketId);
    }

    return result;
  }

  /**
   * Generates available 30-minute access slots for the assigned staff member
   * over the next 3 days, omitting already booked slots and off-shift times.
   */
  static async getAccessSlots(ticketId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    await this.verifyStudentOccupantOrFollower(ticket, user);

    if (!ticket.assignedToId) {
      return { slots: [] };
    }

    const staff = await prisma.user.findUnique({
      where: { id: ticket.assignedToId },
      include: { shifts: true },
    });

    if (!staff || !staff.shifts || staff.shifts.length === 0) {
      return { slots: [] };
    }

    const now = clock.now();

    // Fetch existing booked slots for this staff member
    const bookedTickets = await prisma.ticket.findMany({
      where: {
        assignedToId: ticket.assignedToId,
        id: { not: ticketId },
        status: { in: OPEN_STATUSES },
        preferredSlotStart: { not: null },
      },
      select: {
        preferredSlotStart: true,
        preferredSlotEnd: true,
      },
    });

    const slots: Array<{ start: string; end: string; label: string }> = [];

    for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
      const targetInstant = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const targetParts = toIstParts(targetInstant);

      const dayShifts = staff.shifts.filter((s) => s.weekday === targetParts.weekday);

      for (const shift of dayShifts) {
        for (let minute = shift.startMinute; minute + 30 <= shift.endMinute; minute += 30) {
          const slotStart = fromIstParts(targetParts.year, targetParts.month, targetParts.date, minute);
          const slotEnd = fromIstParts(targetParts.year, targetParts.month, targetParts.date, minute + 30);

          if (slotStart.getTime() <= now.getTime()) {
            continue; // in the past
          }

          const collides = bookedTickets.some((b) => {
            if (!b.preferredSlotStart || !b.preferredSlotEnd) return false;
            return (
              slotStart.getTime() < b.preferredSlotEnd.getTime() &&
              slotEnd.getTime() > b.preferredSlotStart.getTime()
            );
          });

          if (!collides) {
            const startLabel = slotStart.toLocaleString("en-US", {
              timeZone: "Asia/Kolkata",
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            });
            const endLabel = slotEnd.toLocaleString("en-US", {
              timeZone: "Asia/Kolkata",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            });

            slots.push({
              start: slotStart.toISOString(),
              end: slotEnd.toISOString(),
              label: `${startLabel} - ${endLabel}`,
            });
          }
        }
      }
    }

    return { slots };
  }

  /**
   * Occupant responds to locked room visit:
   * Option 1: "COMING_15" -> sets priorityBoostUntil for 15 minutes (rejected if lockedVisitCount >= 2).
   * Option 2: "SLOT" -> sets preferredSlotStart/End for scheduled arrival.
   * Both options: resumes SLA clock, transitions back to ASSIGNED, notifies staff, recomputes queue.
   */
  static async respondAccess(
    ticketId: string,
    user: AuthenticatedUser,
    payload: { option: "COMING_15" | "SLOT"; slotStart?: string }
  ) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    await this.verifyStudentOccupantOrFollower(ticket, user);

    if (ticket.status !== TicketStatus.AWAITING_ACCESS) {
      throw new AppError(400, "INVALID_STATE", `Cannot respond to access for ticket in ${ticket.status}`);
    }

    assertTransition(ticket.status, TicketStatus.ASSIGNED, user.role);

    const now = clock.now();
    let priorityBoostUntil: Date | null = null;
    let preferredSlotStart: Date | null = null;
    let preferredSlotEnd: Date | null = null;
    let note = "";

    if (payload.option === "COMING_15") {
      if ((ticket.lockedVisitCount || 0) >= 2) {
        throw new AppError(
          400,
          "SLOT_REQUIRED",
          "On the 2nd locked visit, you must pick a time slot (15-minute option is not available)"
        );
      }
      priorityBoostUntil = new Date(now.getTime() + 15 * 60 * 1000);
      note = "Occupant indicated: I will be there in 15 minutes";
    } else if (payload.option === "SLOT") {
      if (!payload.slotStart) {
        throw new AppError(400, "SLOT_REQUIRED", "A valid slotStart date/time is required");
      }
      const start = new Date(payload.slotStart);
      if (isNaN(start.getTime()) || start.getTime() <= now.getTime()) {
        throw new AppError(400, "INVALID_SLOT", "Slot start time must be a valid future instant");
      }
      preferredSlotStart = start;
      preferredSlotEnd = new Date(start.getTime() + 30 * 60 * 1000);
      note = `Occupant selected access slot starting at ${start.toISOString()}`;
    } else {
      throw new AppError(400, "INVALID_OPTION", "Invalid access option. Choose COMING_15 or SLOT.");
    }

    const result = await prisma.$transaction(async (tx) => {
      // Resume SLA
      const slaRes = resumeSla(ticket, now);

      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.ASSIGNED,
          priorityBoostUntil,
          preferredSlotStart,
          preferredSlotEnd,
          pausedAt: null,
          totalPausedMinutes: slaRes ? slaRes.totalPausedMinutes : ticket.totalPausedMinutes,
          dueAt: slaRes ? slaRes.dueAt : ticket.dueAt,
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: TicketStatus.AWAITING_ACCESS,
          toStatus: TicketStatus.ASSIGNED,
          type: EventType.ACCESS_RESPONDED,
          note,
          createdAt: now,
        },
      });

      if (ticket.assignedToId) {
        await NotificationService.notify(
          [ticket.assignedToId],
          {
            ticketId,
            type: "ACCESS_RESPONDED",
            message: `Occupant responded on ${ticket.code}: ${
              payload.option === "COMING_15" ? "Will be there in 15 minutes" : "Picked a time slot"
            }`,
          },
          tx
        );
      }

      return {
        success: true,
        status: updated.status,
        priorityBoostUntil: updated.priorityBoostUntil,
        preferredSlotStart: updated.preferredSlotStart,
        dueAt: updated.dueAt,
        totalPausedMinutes: updated.totalPausedMinutes,
      };
    }, TX_OPTIONS);

    if (ticket.assignedToId) {
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "ACCESS_RESPONDED", ticketId);
    }

    return result;
  }

  /**
   * Occupant disputes a locked room claim ("I was in my room").
   * Creates an OPEN Dispute for warden review of door photo and timestamp.
   */
  static async disputeLockedClaim(ticketId: string, user: AuthenticatedUser, reason: string) {
    if (!reason || !reason.trim()) {
      throw new AppError(400, "REASON_REQUIRED", "Dispute reason is required");
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    await this.verifyStudentOccupantOrFollower(ticket, user);

    if ((ticket.lockedVisitCount || 0) < 1 && ticket.status !== TicketStatus.AWAITING_ACCESS) {
      throw new AppError(400, "NO_LOCKED_VISIT", "Ticket has no locked visits to dispute");
    }

    const now = clock.now();

    const result = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.create({
        data: {
          ticketId,
          raisedById: user.id,
          type: DisputeType.LOCKED_CLAIM_FALSE,
          reason: reason.trim(),
          status: DisputeStatus.OPEN,
          createdAt: now,
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          type: EventType.DISPUTE_RAISED,
          note: `Occupant disputed locked claim: ${reason.trim()}`,
          createdAt: now,
        },
      });

      // Notify block warden for review
      const wardens = await tx.user.findMany({
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
            ticketId,
            type: "DISPUTE_RAISED",
            message: `Occupant disputed locked claim for ${ticket.code}: "${reason.trim()}"`,
          },
          tx
        );
      }

      return {
        success: true,
        disputeId: dispute.id,
        status: dispute.status,
      };
    }, TX_OPTIONS);

    return result;
  }

  /**
   * Puts an IN_PROGRESS ticket on hold (waiting for parts).
   * Requires reason, pauses SLA, transitions to ON_HOLD, clears ETAs, recomputes queue.
   */
  static async holdTicket(ticketId: string, user: AuthenticatedUser, reason: string) {
    if (!reason || !reason.trim()) {
      throw new AppError(400, "REASON_REQUIRED", "Reason is required to put a ticket on hold");
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (ticket.assignedToId !== user.id && user.role !== Role.ADMIN) {
      throw new AppError(403, "FORBIDDEN", "Only the assigned staff member can put this ticket on hold");
    }

    if (ticket.status !== TicketStatus.IN_PROGRESS) {
      throw new AppError(
        400,
        "INVALID_STATE",
        `Ticket must be in progress to be put on hold (current: ${ticket.status})`
      );
    }

    assertTransition(ticket.status, TicketStatus.ON_HOLD, user.role, { reason });

    const now = clock.now();

    const result = await prisma.$transaction(async (tx) => {
      // Pause SLA
      pauseSla(ticket, now);

      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.ON_HOLD,
          pausedAt: now,
          etaP50At: null,
          etaP80At: null,
          etaNotifiedP50At: null,
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: TicketStatus.IN_PROGRESS,
          toStatus: TicketStatus.ON_HOLD,
          type: EventType.ON_HOLD,
          note: `Put on hold: ${reason.trim()}`,
          createdAt: now,
        },
      });

      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "TICKET_ON_HOLD",
          message: `Work paused on ${ticket.code}: ${reason.trim()}`,
        },
        tx
      );

      return {
        success: true,
        status: updated.status,
        pausedAt: updated.pausedAt,
      };
    }, TX_OPTIONS);

    if (ticket.assignedToId) {
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "ON_HOLD", ticketId);
    }

    return result;
  }

  /**
   * Resumes an ON_HOLD ticket back to IN_PROGRESS when parts arrive.
   * Resumes SLA clock, regenerates completion code if needed, recomputes queue.
   */
  static async resumeTicket(ticketId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (ticket.assignedToId !== user.id && user.role !== Role.ADMIN) {
      throw new AppError(403, "FORBIDDEN", "Only the assigned staff member can resume this ticket");
    }

    if (ticket.status !== TicketStatus.ON_HOLD) {
      throw new AppError(
        400,
        "INVALID_STATE",
        `Ticket must be on hold to be resumed (current: ${ticket.status})`
      );
    }

    assertTransition(ticket.status, TicketStatus.IN_PROGRESS, user.role);

    const now = clock.now();

    const result = await prisma.$transaction(async (tx) => {
      // Resume SLA
      const slaRes = resumeSla(ticket, now);

      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.IN_PROGRESS,
          pausedAt: null,
          totalPausedMinutes: slaRes ? slaRes.totalPausedMinutes : ticket.totalPausedMinutes,
          dueAt: slaRes ? slaRes.dueAt : ticket.dueAt,
        },
      });

      // Ensure completion code is set and valid
      await this.onEnterInProgress(ticketId, tx);

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: TicketStatus.ON_HOLD,
          toStatus: TicketStatus.IN_PROGRESS,
          type: EventType.RESUMED,
          note: "Parts arrived, work resumed on site",
          createdAt: now,
        },
      });

      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "TICKET_RESUMED",
          message: `Work resumed on ${ticket.code}: ${ticket.title}`,
        },
        tx
      );

      return {
        success: true,
        status: updated.status,
        dueAt: updated.dueAt,
        totalPausedMinutes: updated.totalPausedMinutes,
      };
    }, TX_OPTIONS);

    if (ticket.assignedToId) {
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "RESUMED", ticketId);
    }

    return result;
  }

  /**
   * Assigned staff disputes occupant's code refusal when work is completed.
   * Creates an OPEN Dispute of type CODE_REFUSED for warden review.
   */
  static async reportCodeRefused(ticketId: string, user: AuthenticatedUser, reason: string) {
    if (!reason || !reason.trim()) {
      throw new AppError(400, "REASON_REQUIRED", "Dispute reason is required");
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (ticket.assignedToId !== user.id && user.role !== Role.ADMIN) {
      throw new AppError(403, "FORBIDDEN", "Only the assigned staff member can raise a code refusal dispute");
    }

    if (ticket.status !== TicketStatus.IN_PROGRESS) {
      throw new AppError(
        400,
        "INVALID_STATE",
        `Ticket must be in progress to report code refusal (current: ${ticket.status})`
      );
    }

    const now = clock.now();

    const result = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.create({
        data: {
          ticketId,
          raisedById: user.id,
          type: DisputeType.CODE_REFUSED,
          reason: reason.trim(),
          status: DisputeStatus.OPEN,
          createdAt: now,
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          type: EventType.DISPUTE_RAISED,
          note: `Staff reported occupant refused completion code: ${reason.trim()}`,
          createdAt: now,
        },
      });

      // Notify block warden for review
      const wardens = await tx.user.findMany({
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
            ticketId,
            type: "DISPUTE_RAISED",
            message: `Staff reported code refusal for ${ticket.code}: "${reason.trim()}"`,
          },
          tx
        );
      }

      return {
        success: true,
        disputeId: dispute.id,
        status: dispute.status,
      };
    }, TX_OPTIONS);

    return result;
  }

  /**
   * Optional Warden Verification for CLOSED tickets.
   * - "OK": records WARDEN_VERIFIED event, ticket remains CLOSED.
   * - "PROBLEM": requires note, transitions ticket to REOPENED, reopenCount++, re-routes to staff.
   */
  static async wardenCheck(
    ticketId: string,
    user: AuthenticatedUser,
    payload: { result: "OK" | "PROBLEM"; note?: string }
  ) {
    if (!payload.result || (payload.result !== "OK" && payload.result !== "PROBLEM")) {
      throw new AppError(400, "INVALID_RESULT", "Verification result must be OK or PROBLEM");
    }

    if (payload.result === "PROBLEM" && (!payload.note || !payload.note.trim())) {
      throw new AppError(400, "REASON_REQUIRED", "A note is required when marking a problem found");
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (user.role === Role.WARDEN && ticket.blockId !== user.blockId) {
      throw new AppError(403, "FORBIDDEN", "Wardens can only verify tickets in their assigned block");
    }

    if (ticket.status !== TicketStatus.CLOSED) {
      throw new AppError(400, "INVALID_STATE", "Only closed tickets can undergo warden verification");
    }

    const now = clock.now();
    let oldAssignedStaffId: string | null = null;
    let newAssignedStaffId: string | null = null;

    const result = await prisma.$transaction(async (tx) => {
      if (payload.result === "OK") {
        await tx.ticketEvent.create({
          data: {
            ticketId,
            actorId: user.id,
            fromStatus: TicketStatus.CLOSED,
            toStatus: TicketStatus.CLOSED,
            type: EventType.WARDEN_VERIFIED,
            note: payload.note ? payload.note.trim() : "Warden marked verified OK",
            createdAt: now,
          },
        });

        return {
          success: true,
          status: TicketStatus.CLOSED,
          result: "OK",
        };
      }

      // PROBLEM: reopen ticket
      assertTransition(ticket.status, TicketStatus.REOPENED, user.role, { reason: payload.note });
      oldAssignedStaffId = ticket.assignedToId;

      const nextReopenCount = (ticket.reopenCount || 0) + 1;

      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.REOPENED,
          reopenCount: nextReopenCount,
          closedAt: null,
          closeReason: null,
          resolvedAt: null,
          startedAt: null,
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: TicketStatus.CLOSED,
          toStatus: TicketStatus.REOPENED,
          type: EventType.STATUS_CHANGED,
          note: `Warden marked problem found: ${payload.note!.trim()}`,
          createdAt: now,
        },
      });

      // Re-route
      const route = await RoutingService.chooseAssignee(
        {
          id: ticketId,
          categoryId: ticket.categoryId,
          blockId: ticket.blockId,
          priority: ticket.priority,
          createdAt: ticket.createdAt,
          preferredStaffId: ticket.assignedToId,
        },
        tx
      );

      let finalStatus = TicketStatus.REOPENED;

      if (route) {
        finalStatus = TicketStatus.ASSIGNED;
        newAssignedStaffId = route.staffId;

        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            status: TicketStatus.ASSIGNED,
            assignedToId: route.staffId,
            etaP50At: route.etaP50At,
            etaP80At: route.etaP80At,
          },
        });

        await tx.ticketEvent.create({
          data: {
            ticketId,
            actorId: user.id,
            fromStatus: TicketStatus.REOPENED,
            toStatus: TicketStatus.ASSIGNED,
            type: EventType.STATUS_CHANGED,
            note: `Reassigned to staff ${route.staffId}`,
            createdAt: now,
          },
        });
      } else {
        finalStatus = TicketStatus.RAISED;
        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            status: TicketStatus.RAISED,
            assignedToId: null,
            etaP50At: null,
            etaP80At: null,
          },
        });
      }

      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "WARDEN_PROBLEM_FOUND",
          message: `Warden inspected ${ticket.code} and found a problem: ${payload.note!.trim()}`,
        },
        tx
      );

      return {
        success: true,
        status: finalStatus,
        result: "PROBLEM",
        reopenCount: nextReopenCount,
      };
    }, TX_OPTIONS);

    if (oldAssignedStaffId) {
      await this.safeRecomputeStaffQueue(oldAssignedStaffId, "TICKET_DISPUTED", ticketId);
    }
    if (newAssignedStaffId && newAssignedStaffId !== oldAssignedStaffId) {
      await this.safeRecomputeStaffQueue(newAssignedStaffId, "TICKET_DISPUTED", ticketId);
    }

    return result;
  }

  /**
   * Warden or Chief Warden updates priority
   */
  static async updatePriority(
    ticketId: string,
    priority: Priority,
    reason: string,
    user: AuthenticatedUser
  ) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (user.role === Role.WARDEN && ticket.blockId !== user.blockId) {
      throw new AppError(403, "FORBIDDEN", "Wardens can only update tickets in their assigned block");
    }

    if (!([Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] as Role[]).includes(user.role)) {
      throw new AppError(403, "FORBIDDEN", "Only wardens can change ticket priority");
    }

    if (!OPEN_STATUSES.includes(ticket.status)) {
      throw new AppError(
        400,
        "TICKET_NOT_OPEN",
        `Cannot change priority on ticket with status ${ticket.status}. Priority can only be changed on open tickets.`
      );
    }

    if (ticket.priority === priority) {
      throw new AppError(
        400,
        "PRIORITY_UNCHANGED",
        `Ticket already has priority ${priority}`
      );
    }

    const now = clock.now();

    const res = await prisma.$transaction(async (tx) => {
      // Note: dueAt stays category-based per domain rule 5.2
      const updated = await tx.ticket.updateMany({
        where: {
          id: ticketId,
          status: ticket.status,
        },
        data: { priority },
      });

      if (updated.count === 0) {
        throw new AppError(409, "TICKET_CHANGED", "This ticket was modified by another operation. Please refresh.");
      }

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          type: "PRIORITY_CHANGED",
          note: `Priority changed to ${priority}. Reason: ${reason}`,
          createdAt: now,
        },
      });

      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "PRIORITY_CHANGED",
          message: `Ticket ${ticket.code} priority changed to ${priority}`,
        },
        tx
      );

      return updated;
    }, TX_OPTIONS);

    if (ticket.assignedToId) {
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "PRIORITY_CHANGED", ticketId);
    }

    return res;
  }

  /**
   * Warden reassigns ticket to another active staff member of the same trade
   */
  static async reassign(ticketId: string, newStaffId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (user.role === Role.WARDEN && ticket.blockId !== user.blockId) {
      throw new AppError(403, "FORBIDDEN", "Wardens can only reassign tickets in their block");
    }

    if (!([Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] as Role[]).includes(user.role)) {
      throw new AppError(403, "FORBIDDEN", "Only wardens or administrators can reassign tickets");
    }

    if (!OPEN_STATUSES.includes(ticket.status)) {
      throw new AppError(
        409,
        "INVALID_TRANSITION",
        `Cannot reassign ticket with status ${ticket.status}. Reassignment is only allowed for open tickets.`
      );
    }

    assertTransition(ticket.status, TicketStatus.ASSIGNED, user.role);

    // Verify new staff member
    const newStaff = await prisma.user.findUnique({
      where: { id: newStaffId },
    });

    if (!newStaff || !newStaff.isActive || newStaff.role !== Role.STAFF) {
      throw new AppError(400, "INVALID_STAFF", "Selected staff member is not active");
    }

    if (newStaff.trade !== ticket.category.trade) {
      throw new AppError(
        400,
        "TRADE_MISMATCH",
        `Staff member must be of trade ${ticket.category.trade}`
      );
    }

    const now = clock.now();

    const res = await prisma.$transaction(async (tx) => {
      const oldStaffId = ticket.assignedToId;

      // Conditional update for concurrency protection
      const updated = await tx.ticket.updateMany({
        where: {
          id: ticketId,
          status: ticket.status,
        },
        data: {
          assignedToId: newStaffId,
          status: TicketStatus.ASSIGNED,
        },
      });

      if (updated.count === 0) {
        throw new AppError(409, "TICKET_CHANGED", "This ticket was modified by another operation. Please refresh.");
      }

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: ticket.status,
          toStatus: TicketStatus.ASSIGNED,
          type: "REASSIGNED",
          note: `Reassigned from status ${ticket.status} to ASSIGNED (${newStaff.name}, ${newStaff.trade})`,
          createdAt: now,
        },
      });

      // Notify new staff, old staff, and audience
      const notifyTargets = new Set<string>();
      if (oldStaffId) notifyTargets.add(oldStaffId);
      notifyTargets.add(newStaffId);

      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      for (const id of audience) notifyTargets.add(id);
      notifyTargets.delete(user.id);

      await NotificationService.notify(
        Array.from(notifyTargets),
        {
          ticketId,
          type: "TICKET_REASSIGNED",
          message: `Ticket ${ticket.code} reassigned to ${newStaff.name}`,
        },
        tx
      );

      return { success: true, status: TicketStatus.ASSIGNED, assignedToId: newStaffId };
    }, TX_OPTIONS);

    if (ticket.assignedToId) {
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "REASSIGNED_OUT", ticketId);
    }
    await this.safeRecomputeStaffQueue(newStaffId, "REASSIGNED_IN", ticketId);

    return res;
  }

  /**
   * Assigns a RAISED ticket with no staff member (allowed only from RAISED)
   */
  static async assignTicket(ticketId: string, staffId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (ticket.status !== TicketStatus.RAISED) {
      throw new AppError(
        409,
        "INVALID_TRANSITION",
        `Manual initial assignment is only allowed from RAISED status (current: ${ticket.status})`
      );
    }

    assertTransition(ticket.status, TicketStatus.ASSIGNED, user.role);

    if (user.role === Role.WARDEN && ticket.blockId !== user.blockId) {
      throw new AppError(403, "FORBIDDEN", "Wardens can only assign tickets in their block");
    }

    if (!([Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] as Role[]).includes(user.role)) {
      throw new AppError(403, "FORBIDDEN", "Only wardens or administrators can assign tickets");
    }

    const staff = await prisma.user.findUnique({
      where: { id: staffId },
    });

    if (!staff || !staff.isActive || staff.role !== Role.STAFF) {
      throw new AppError(400, "INVALID_STAFF", "Selected staff member is not active");
    }

    if (staff.trade !== ticket.category.trade) {
      throw new AppError(
        400,
        "TRADE_MISMATCH",
        `Staff member must be of trade ${ticket.category.trade}`
      );
    }

    const now = clock.now();

    const res = await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: {
          id: ticketId,
          status: TicketStatus.RAISED,
        },
        data: {
          assignedToId: staffId,
          status: TicketStatus.ASSIGNED,
        },
      });

      if (updated.count === 0) {
        throw new AppError(409, "TICKET_CHANGED", "This ticket was modified by another operation. Please refresh.");
      }

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: TicketStatus.RAISED,
          toStatus: TicketStatus.ASSIGNED,
          type: "ASSIGNED",
          note: `Assigned to ${staff.name} (${staff.trade})`,
          createdAt: now,
        },
      });

      const notifyTargets = new Set<string>();
      notifyTargets.add(staffId);
      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      for (const id of audience) notifyTargets.add(id);
      notifyTargets.delete(user.id);

      await NotificationService.notify(
        Array.from(notifyTargets),
        {
          ticketId,
          type: "TICKET_ASSIGNED",
          message: `Ticket ${ticket.code} assigned to ${staff.name}`,
        },
        tx
      );

      return { success: true, status: TicketStatus.ASSIGNED, assignedToId: staffId };
    }, TX_OPTIONS);

    await this.safeRecomputeStaffQueue(staffId, "ASSIGNED", ticketId);

    return res;
  }

  /**
   * Warden rejects a ticket with reason
   */
  static async rejectTicket(ticketId: string, reason: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    if (user.role === Role.WARDEN && ticket.blockId !== user.blockId) {
      throw new AppError(403, "FORBIDDEN", "Wardens can only reject tickets in their block");
    }

    assertTransition(ticket.status, TicketStatus.REJECTED, user.role, { reason });

    const now = clock.now();

    const res = await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: {
          id: ticketId,
          status: ticket.status,
        },
        data: {
          status: TicketStatus.REJECTED,
          closedAt: now,
        },
      });

      if (updated.count === 0) {
        throw new AppError(409, "TICKET_CHANGED", "This ticket was modified by another operation. Please refresh.");
      }

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: ticket.status,
          toStatus: TicketStatus.REJECTED,
          type: "REJECTED",
          note: `Rejected by ${user.name}: ${reason}`,
          createdAt: now,
        },
      });

      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "TICKET_REJECTED",
          message: `Ticket ${ticket.code} was rejected: ${reason}`,
        },
        tx
      );

      return { success: true, status: TicketStatus.REJECTED };
    }, TX_OPTIONS);

    if (ticket.assignedToId) {
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "REJECTED", ticketId);
    }

    return res;
  }

  /**
   * Comments
   */
  static async addComment(ticketId: string, body: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { followers: { select: { userId: true } } },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    TicketAccessService.assertCanView(user, ticket);

    const now = clock.now();

    return await prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: {
          ticketId,
          authorId: user.id,
          body,
          createdAt: now,
        },
        include: {
          author: {
            select: { id: true, name: true, role: true },
          },
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: user.id,
          type: "COMMENTED",
          note: `${user.name} commented: "${body.length > 50 ? body.substring(0, 47) + "..." : body}"`,
          createdAt: now,
        },
      });

      const audience = await NotificationService.getTicketAudience(ticketId, user.id, tx);
      await NotificationService.notify(
        audience,
        {
          ticketId,
          type: "TICKET_COMMENT",
          message: `${user.name} commented on ${ticket.code}`,
        },
        tx
      );

      return comment;
    }, TX_OPTIONS);
  }

  static async getComments(ticketId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { followers: { select: { userId: true } } },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    TicketAccessService.assertCanView(user, ticket);

    return await prisma.comment.findMany({
      where: { ticketId },
      include: {
        author: {
          select: { id: true, name: true, role: true, trade: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Retrieves single ticket details
   */
  static async getTicket(ticketId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        number: true,
        code: true,
        locationType: true,
        roomId: true,
        blockId: true,
        floor: true,
        commonSpot: true,
        categoryId: true,
        priority: true,
        title: true,
        description: true,
        status: true,
        closeReason: true,
        raisedById: true,
        assignedToId: true,
        parentTicketId: true,
        dueAt: true,
        pausedAt: true,
        totalPausedMinutes: true,
        escalationLevel: true,
        escalatedAt: true,
        reopenCount: true,
        lockedVisitCount: true,
        preferredSlotStart: true,
        preferredSlotEnd: true,
        startedAt: true,
        resolvedAt: true,
        closedAt: true,
        etaP50At: true,
        etaP80At: true,
        etaNotifiedP50At: true,
        createdAt: true,
        updatedAt: true,
        room: { select: { id: true, number: true, floor: true } },
        block: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, trade: true, slaMinutes: true, defaultPriority: true } },
        assignedTo: { select: { id: true, name: true, trade: true } },
        raisedBy: { select: { id: true, name: true } },
        followers: { select: { userId: true } },
        attachments: {
          select: {
            id: true,
            url: true,
            publicId: true,
            kind: true,
            createdAt: true,
            uploader: {
              select: {
                id: true,
                name: true,
                role: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        disputes: {
          select: {
            id: true,
            type: true,
            status: true,
            reason: true,
            decision: true,
            decisionNote: true,
            createdAt: true,
            decidedAt: true,
            raisedBy: { select: { id: true, name: true, role: true } },
            decidedBy: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { followers: true, comments: true } },
      },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    TicketAccessService.assertCanView(user, ticket as any);

    const isFollowing = ticket.followers.some((f) => f.userId === user.id);

    // The follower list is only needed for the access check above; don't send other
    // students' user IDs to the client.
    const { followers: _followers, ...ticketWithoutFollowers } = ticket;

    return {
      ...ticketWithoutFollowers,
      followerCount: ticket._count.followers,
      commentCount: ticket._count.comments,
      isFollowing,
    };
  }

  /**
   * Fetches completion code. Accessible ONLY by current occupants of that room,
   * and ONLY while the ticket is IN_PROGRESS. All other requests return 404 NOT_FOUND.
   */
  static async getCompletionCode(ticketId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        status: true,
        locationType: true,
        roomId: true,
        completionCode: true,
      },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    // Must be currently IN_PROGRESS
    if (ticket.status !== TicketStatus.IN_PROGRESS) {
      throw new AppError(404, "NOT_FOUND", "Completion code not available");
    }

    // Must be a ROOM ticket
    if (ticket.locationType !== LocationType.ROOM || !ticket.roomId) {
      throw new AppError(404, "NOT_FOUND", "Completion code not available");
    }

    // ONLY current room occupants
    const isCurrentOccupant =
      user.role === Role.STUDENT && Boolean(user.currentRoomId && user.currentRoomId === ticket.roomId);

    if (!isCurrentOccupant) {
      throw new AppError(404, "NOT_FOUND", "Completion code not available");
    }

    return {
      ticketId: ticket.id,
      code: ticket.completionCode,
    };
  }

  /**
   * Ticket timeline
   */
  static async getTicketEvents(ticketId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { followers: { select: { userId: true } } },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    TicketAccessService.assertCanView(user, ticket);

    return await prisma.ticketEvent.findMany({
      where: { ticketId },
      include: {
        actor: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Paginated ticket listing with filters
   */
  static async listTickets(
    user: AuthenticatedUser,
    filters: {
      page: number;
      limit: number;
      status?: TicketStatus;
      categoryId?: string;
      priority?: Priority;
      floor?: number;
      locationType?: LocationType;
      assignedToId?: string;
      search?: string;
    }
  ) {
    const baseFilter = TicketAccessService.buildListFilter(user);

    const where: Prisma.TicketWhereInput = {
      AND: [baseFilter],
    };

    const andConditions = where.AND as Prisma.TicketWhereInput[];

    if (filters.status) andConditions.push({ status: filters.status });
    if (filters.categoryId) andConditions.push({ categoryId: filters.categoryId });
    if (filters.priority) andConditions.push({ priority: filters.priority });
    if (filters.floor) andConditions.push({ floor: filters.floor });
    if (filters.locationType) andConditions.push({ locationType: filters.locationType });

    if (filters.assignedToId && ([Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN] as Role[]).includes(user.role)) {
      andConditions.push({ assignedToId: filters.assignedToId });
    }

    if (filters.search) {
      andConditions.push({
        OR: [
          { code: { contains: filters.search, mode: "insensitive" } },
          { title: { contains: filters.search, mode: "insensitive" } },
        ],
      });
    }

    const skip = (filters.page - 1) * filters.limit;

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        select: {
          id: true,
          number: true,
          code: true,
          locationType: true,
          roomId: true,
          blockId: true,
          floor: true,
          commonSpot: true,
          categoryId: true,
          priority: true,
          title: true,
          description: true,
          status: true,
          closeReason: true,
          raisedById: true,
          assignedToId: true,
          dueAt: true,
          escalationLevel: true,
          reopenCount: true,
          startedAt: true,
          resolvedAt: true,
          closedAt: true,
          etaP50At: true,
          etaP80At: true,
          createdAt: true,
          updatedAt: true,
          category: { select: { id: true, name: true, trade: true } },
          room: { select: { id: true, number: true, floor: true } },
          block: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true, trade: true } },
          _count: { select: { followers: true, comments: true } },
        },
        orderBy: [
          { closedAt: { sort: "asc", nulls: "first" } },
          { priority: "desc" },
          { createdAt: "desc" },
        ],
        take: filters.limit,
        skip,
      }),
      prisma.ticket.count({ where }),
    ]);

    const statusGroup = (s: TicketStatus): number => {
      if (OPEN_STATUSES.includes(s)) return 0;
      if (s === TicketStatus.AWAITING_VERIFICATION || s === TicketStatus.RESOLVED) return 1;
      return 2; // CLOSED, REJECTED
    };

    const priorityRank = (p: Priority): number => {
      if (p === Priority.URGENT) return 0;
      if (p === Priority.NORMAL) return 1;
      return 2; // LOW
    };

    const sortedTickets = tickets
      .map((t) => ({
        ...t,
        followerCount: t._count.followers,
        commentCount: t._count.comments,
      }))
      .sort((a, b) => {
        const sDiff = statusGroup(a.status) - statusGroup(b.status);
        if (sDiff !== 0) return sDiff;
        const pDiff = priorityRank(a.priority) - priorityRank(b.priority);
        if (pDiff !== 0) return pDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

    return {
      tickets: sortedTickets,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  /**
   * Returns ETA explanation details for a ticket.
   * Privacy guarantee: jobsAhead includes ONLY { code, priority, estMinutes } without student/room identities.
   */
  static async getEtaExplanation(ticketId: string, user: AuthenticatedUser) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        category: true,
        block: true,
        assignedTo: {
          select: {
            id: true,
            name: true,
            trade: true,
            shifts: {
              select: {
                weekday: true,
                startMinute: true,
                endMinute: true,
              },
            },
          },
        },
        followers: { select: { userId: true } },
      },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    TicketAccessService.assertCanView(user, ticket as any);

    const estimate = await getDurationEstimate(ticket.categoryId, ticket.blockId);

    let jobsAhead: Array<{ code: string; priority: Priority; estMinutes: number }> = [];
    let shiftToday: {
      windows: Array<{
        startMinute: number;
        endMinute: number;
        startFormatted: string;
        endFormatted: string;
        formatted: string;
      }>;
      summary: string;
      startMinute: number;
      endMinute: number;
      startFormatted: string;
      endFormatted: string;
    } | null = null;

    if (ticket.assignedTo) {
      const staff = ticket.assignedTo;
      const now = clock.now();
      const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      const currentWeekday = istDate.getUTCDay();

      const todayShifts = staff.shifts
        .filter((s) => s.weekday === currentWeekday)
        .sort((a, b) => a.startMinute - b.startMinute);

      if (todayShifts.length > 0) {
        const formatMin = (m: number) => {
          const h = Math.floor(m / 60);
          const min = m % 60;
          const ampm = h >= 12 ? "PM" : "AM";
          const dh = h % 12 || 12;
          return `${dh}:${String(min).padStart(2, "0")} ${ampm}`;
        };

        const windows = todayShifts.map((s) => ({
          startMinute: s.startMinute,
          endMinute: s.endMinute,
          startFormatted: formatMin(s.startMinute),
          endFormatted: formatMin(s.endMinute),
          formatted: `${formatMin(s.startMinute)}–${formatMin(s.endMinute)}`,
        }));

        const windowStrings = windows.map((w) => w.formatted);
        const windowsText =
          windowStrings.length === 1
            ? windowStrings[0]
            : windowStrings.slice(0, -1).join(", ") + " and " + windowStrings[windowStrings.length - 1];

        shiftToday = {
          windows,
          summary: `works ${windowsText} today`,
          startMinute: windows[0].startMinute,
          endMinute: windows[windows.length - 1].endMinute,
          startFormatted: windows[0].startFormatted,
          endFormatted: windows[windows.length - 1].endFormatted,
        };
      }

      // Load active tickets in staff member's open queue
      const staffTickets = await prisma.ticket.findMany({
        where: {
          assignedToId: staff.id,
          status: { in: OPEN_STATUSES },
        },
        select: {
          id: true,
          code: true,
          categoryId: true,
          blockId: true,
          priority: true,
          status: true,
          createdAt: true,
          startedAt: true,
          preferredSlotStart: true,
        },
        orderBy: { createdAt: "asc" },
      });

      const estCache = new Map<string, EstimateResult>();
      const simJobs: JobDurationsInput[] = await Promise.all(
        staffTickets.map(async (st) => {
          const cacheKey = `${st.categoryId}:${st.blockId}`;
          let est = estCache.get(cacheKey);
          if (!est) {
            est = await getDurationEstimate(st.categoryId, st.blockId);
            estCache.set(cacheKey, est);
          }
          return {
            ticketId: st.id,
            priority: st.priority as JobPriority,
            createdAt: st.createdAt,
            status: st.status,
            startedAt: st.startedAt,
            notBefore: st.preferredSlotStart,
            p50Minutes: est.p50Minutes,
            p80Minutes: est.p80Minutes,
          };
        })
      );

      const { p50Schedule } = simulateQueueRanges({
        now,
        shifts: staff.shifts as ShiftWindow[],
        jobs: simJobs,
      });

      const thisSched = p50Schedule.get(ticket.id);
      if (thisSched) {
        for (const st of staffTickets) {
          if (st.id === ticket.id) continue;
          const sched = p50Schedule.get(st.id);
          if (sched && sched.startAt.getTime() < thisSched.startAt.getTime()) {
            const est = estCache.get(`${st.categoryId}:${st.blockId}`);
            jobsAhead.push({
              code: st.code,
              priority: st.priority,
              estMinutes: est ? est.p50Minutes : 45,
            });
          }
        }
      }
    }

    const history = await prisma.ticketPrediction.findMany({
      where: { ticketId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        predictedP50At: true,
        predictedP80At: true,
        createdAt: true,
      },
    });

    return {
      assignee: ticket.assignedTo
        ? {
            id: ticket.assignedTo.id,
            name: ticket.assignedTo.name,
            trade: ticket.assignedTo.trade,
          }
        : null,
      estimate,
      jobsAhead,
      shiftToday,
      etaP50At: ticket.etaP50At,
      etaP80At: ticket.etaP80At,
      history,
    };
  }
}
