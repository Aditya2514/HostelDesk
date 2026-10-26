import { Prisma, LocationType, Priority, TicketStatus, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { AppError } from "../../lib/errors";
import { AuthenticatedUser } from "../../types/express";
import { RoutingService } from "../scheduling/routing.service";
import { EtaService } from "../scheduling/eta.service";
import { getDurationEstimate, EstimateResult } from "../scheduling/estimator";
import { simulateQueueRanges, JobDurationsInput, JobPriority } from "../scheduling/simulator";
import { ShiftWindow } from "../scheduling/shifts";
import { NotificationService } from "../notifications/notification.service";
import { TicketAccessService } from "./ticketAccess.service";
import { assertTransition } from "./stateMachine";

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
  private static async safeRecomputeStaffQueue(staffId: string, reason: string): Promise<void> {
    try {
      await EtaService.recomputeStaffQueue(staffId, reason);
    } catch (err) {
      console.error(`[EtaService] Post-commit queue recompute failed for staff ${staffId} (${reason}):`, err);
    }
  }

  /**
   * Phase 4 hook: executed when ticket enters IN_PROGRESS.
   * Phase 4 will implement 4-digit completion code generation here.
   */
  static async onEnterInProgress(_ticketId: string, _tx: Prisma.TransactionClient): Promise<void> {
    // Phase 4: generate completion code
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
      await this.safeRecomputeStaffQueue(result.assignedToId, "new ticket was assigned to your queue");
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
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "work started on site");
    }

    return res;
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
      await this.safeRecomputeStaffQueue(
        ticket.assignedToId,
        `ticket priority changed to ${priority}`
      );
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
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "ticket reassigned away from queue");
    }
    await this.safeRecomputeStaffQueue(newStaffId, "ticket reassigned to queue");

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

    await this.safeRecomputeStaffQueue(staffId, "ticket assigned to queue");

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
      await this.safeRecomputeStaffQueue(ticket.assignedToId, "ticket rejected and removed from queue");
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
        _count: { select: { followers: true, comments: true } },
      },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    TicketAccessService.assertCanView(user, ticket as any);

    const isFollowing = ticket.followers.some((f) => f.userId === user.id);

    return {
      ...ticket,
      followerCount: ticket._count.followers,
      commentCount: ticket._count.comments,
      isFollowing,
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

      const todayShift = staff.shifts.find((s) => s.weekday === currentWeekday);
      if (todayShift) {
        const formatMin = (m: number) => {
          const h = Math.floor(m / 60);
          const min = m % 60;
          const ampm = h >= 12 ? "PM" : "AM";
          const dh = h % 12 || 12;
          return `${dh}:${String(min).padStart(2, "0")} ${ampm}`;
        };
        shiftToday = {
          startMinute: todayShift.startMinute,
          endMinute: todayShift.endMinute,
          startFormatted: formatMin(todayShift.startMinute),
          endFormatted: formatMin(todayShift.endMinute),
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
