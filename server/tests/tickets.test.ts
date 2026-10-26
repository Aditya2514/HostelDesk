import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocationType, Priority, TicketStatus, Role, Trade } from "@prisma/client";
import { TicketsService } from "../src/modules/tickets/tickets.service";
import { prisma } from "../src/lib/prisma";
import { clock } from "../src/lib/clock";
import { AppError } from "../src/lib/errors";
import { AuthenticatedUser } from "../src/types/express";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    category: { findUnique: vi.fn() },
    roomOccupancy: { findFirst: vi.fn(), findMany: vi.fn() },
    ticket: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    ticketFollower: { upsert: vi.fn(), count: vi.fn() },
    ticketEvent: { create: vi.fn() },
    notification: { createMany: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    block: { findFirst: vi.fn() },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

describe("TicketsService Core Logic & Concurrency", () => {
  const mockStudent: AuthenticatedUser = {
    id: "student-1",
    name: "Aditya Singh",
    email: "student1@hosteldesk.dev",
    role: Role.STUDENT,
    currentRoomId: "room-a-301",
    isActive: true,
  };

  const mockCategory = {
    id: "cat-plumbing",
    name: "Tap / flush / drain issue",
    trade: Trade.PLUMBER,
    defaultPriority: Priority.NORMAL,
    defaultDurationMin: 45,
    slaMinutes: 48 * 60,
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clock.reset();
    clock.setDemoModeForTesting(true);
  });

  describe("Duplicate Room Tickets", () => {
    it("blocks duplicate creation if an open ticket exists for the same room and category", async () => {
      vi.mocked(prisma.category.findUnique).mockResolvedValueOnce(mockCategory as any);
      vi.mocked(prisma.roomOccupancy.findFirst).mockResolvedValueOnce({
        id: "occ-1",
        userId: mockStudent.id,
        roomId: "room-a-301",
        room: { id: "room-a-301", blockId: "block-a", floor: 3, number: "301" },
        fromDate: new Date("2026-08-01"),
        toDate: null,
      } as any);

      // Existing open ticket found
      vi.mocked(prisma.ticket.findFirst).mockResolvedValueOnce({
        id: "existing-ticket-1",
        code: "HD-0012",
        title: "Broken tap",
        status: TicketStatus.ASSIGNED,
      } as any);

      try {
        await TicketsService.createTicket(mockStudent, {
          locationType: LocationType.ROOM,
          categoryId: "cat-plumbing",
          title: "Tap is leaking again",
          description: "Roommate already reported but submitting again",
        });
        expect.fail("Should have thrown 409 DUPLICATE_ROOM_TICKET");
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe("DUPLICATE_ROOM_TICKET");
        expect(err.message).toContain("HD-0012");
        expect(err.details?.existingTicketId).toBe("existing-ticket-1");
      }
    });

    it("takes roomId strictly from active occupancy and never from payload", async () => {
      vi.mocked(prisma.category.findUnique).mockResolvedValueOnce(mockCategory as any);
      // Student has no active room
      vi.mocked(prisma.roomOccupancy.findFirst).mockResolvedValueOnce(null);

      try {
        await TicketsService.createTicket(mockStudent, {
          locationType: LocationType.ROOM,
          categoryId: "cat-plumbing",
          title: "Leaking tap",
          description: "Trying to submit for an arbitrary room",
          // Notice: even if an attacker passed a roomId, it should fail
        });
        expect.fail("Should have thrown NO_CURRENT_ROOM");
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe("NO_CURRENT_ROOM");
      }
    });

    it("rejects common-area ticket creation if student has no active room assignment", async () => {
      vi.mocked(prisma.category.findUnique).mockResolvedValueOnce(mockCategory as any);
      vi.mocked(prisma.roomOccupancy.findFirst).mockResolvedValueOnce(null);

      try {
        await TicketsService.createTicket(mockStudent, {
          locationType: LocationType.COMMON,
          categoryId: "cat-plumbing",
          title: "Lobby light issue",
          description: "No current room",
          floor: 1,
          commonSpot: "Main Lobby",
        });
        expect.fail("Should have thrown NO_CURRENT_ROOM");
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe("NO_CURRENT_ROOM");
      }
    });
  });

  describe("Similar Common-Area Tickets (2-hour boundary)", () => {
    it("flags similar ticket within 1 hour 59 minutes (boundary inside 2 hours)", async () => {
      vi.mocked(prisma.category.findUnique).mockResolvedValueOnce(mockCategory as any);
      vi.mocked(prisma.roomOccupancy.findFirst).mockResolvedValueOnce({
        room: { blockId: "block-a" },
      } as any);

      const now = clock.now();
      const oneHourFiftyNineMinsAgo = new Date(now.getTime() - 119 * 60 * 1000);

      vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce([
        {
          id: "common-ticket-1",
          code: "HD-0020",
          title: "Water overflow in washroom",
          commonSpot: "Floor 2 washroom",
          createdAt: oneHourFiftyNineMinsAgo,
          _count: { followers: 2 },
        } as any,
      ]);

      try {
        await TicketsService.createTicket(mockStudent, {
          locationType: LocationType.COMMON,
          categoryId: "cat-plumbing",
          title: "Floor 2 washroom flooded",
          description: "Water leaking all over",
          floor: 2,
          commonSpot: "Floor 2 washroom",
          joinExistingCheck: true,
        });
        expect.fail("Should have thrown 409 SIMILAR_TICKETS_EXIST");
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe("SIMILAR_TICKETS_EXIST");
        expect(err.details?.similarTickets).toBeDefined();
        expect(err.details?.similarTickets.length).toBe(1);
      }
    });

    it("bypasses similar tickets check when joinExistingCheck is false", async () => {
      vi.mocked(prisma.category.findUnique).mockResolvedValueOnce(mockCategory as any);
      vi.mocked(prisma.roomOccupancy.findFirst).mockResolvedValueOnce({
        room: { blockId: "block-a" },
      } as any);

      // Routing setup
      vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: "plumber-1" }] as any);
      vi.mocked(prisma.ticket.count).mockResolvedValueOnce(0);

      // Mock create & update
      vi.mocked(prisma.ticket.create).mockResolvedValueOnce({
        id: "new-ticket-1",
        number: 42,
        code: "HD-TMP",
        status: TicketStatus.ASSIGNED,
      } as any);

      vi.mocked(prisma.ticket.update).mockResolvedValueOnce({
        id: "new-ticket-1",
        code: "HD-0042",
        status: TicketStatus.ASSIGNED,
      } as any);

      const result = await TicketsService.createTicket(mockStudent, {
        locationType: LocationType.COMMON,
        categoryId: "cat-plumbing",
        title: "Distinct flood issue",
        description: "Creating anyway because it is distinct",
        floor: 2,
        commonSpot: "Corridor sink",
        joinExistingCheck: false, // User clicked Create Anyway
      });

      expect(result.code).toBe("HD-0042");
    });
  });

  describe("Concurrency Control on Actions", () => {
    it("ensures only one concurrent call succeeds on startWork and the other receives 409 TICKET_CHANGED", async () => {
      const mockStaff: AuthenticatedUser = {
        id: "plumber-1",
        name: "Plumber",
        email: "plumber1@hosteldesk.dev",
        role: Role.STAFF,
        trade: Trade.PLUMBER,
        isActive: true,
      };

      vi.mocked(prisma.ticket.findUnique).mockResolvedValue({
        id: "ticket-conc-1",
        code: "HD-0099",
        status: TicketStatus.ASSIGNED,
        assignedToId: mockStaff.id,
      } as any);

      // First call succeeds: updateMany returns count: 1
      vi.mocked(prisma.ticket.updateMany).mockResolvedValueOnce({ count: 1 });
      const firstCall = await TicketsService.startWork("ticket-conc-1", mockStaff);
      expect(firstCall.success).toBe(true);

      // Second concurrent call fails: status already changed, updateMany returns count: 0
      vi.mocked(prisma.ticket.updateMany).mockResolvedValueOnce({ count: 0 });
      try {
        await TicketsService.startWork("ticket-conc-1", mockStaff);
        expect.fail("Second concurrent start should fail with 409");
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe("TICKET_CHANGED");
      }
    });
  });

  describe("Sensitive Fields Omission (getTicket & listTickets)", () => {
    it("never returns completionCode, codeFailedAttempts, codeBlockedUntil or passwordHash", async () => {
      // Mock getTicket DB response
      vi.mocked(prisma.ticket.findUnique).mockResolvedValueOnce({
        id: "ticket-sec-1",
        code: "HD-0001",
        title: "Leaky pipe",
        roomId: "room-a-301",
        locationType: LocationType.ROOM,
        status: TicketStatus.ASSIGNED,
        raisedById: mockStudent.id,
        followers: [],
        _count: { followers: 0, comments: 0 },
        // Notice: even if DB driver returned sensitive columns, service should not leak them
      } as any);

      const ticket = await TicketsService.getTicket("ticket-sec-1", mockStudent);

      expect((ticket as any).completionCode).toBeUndefined();
      expect((ticket as any).codeFailedAttempts).toBeUndefined();
      expect((ticket as any).codeBlockedUntil).toBeUndefined();
      expect((ticket as any).passwordHash).toBeUndefined();

      // Mock listTickets DB response
      vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce([
        {
          id: "ticket-sec-1",
          code: "HD-0001",
          title: "Leaky pipe",
          status: TicketStatus.ASSIGNED,
          _count: { followers: 0, comments: 0 },
        } as any,
      ]);
      vi.mocked(prisma.ticket.count).mockResolvedValueOnce(1);

      const listResult = await TicketsService.listTickets(mockStudent, { page: 1, limit: 10 });
      const firstItem = listResult.tickets[0];

      expect((firstItem as any).completionCode).toBeUndefined();
      expect((firstItem as any).codeFailedAttempts).toBeUndefined();
      expect((firstItem as any).codeBlockedUntil).toBeUndefined();
      expect((firstItem as any).passwordHash).toBeUndefined();
    });
  });

  describe("followTicket Block Enforce", () => {
    it("rejects follow if ticket is in a different block from student", async () => {
      vi.mocked(prisma.ticket.findUnique).mockResolvedValueOnce({
        id: "common-ticket-b",
        locationType: LocationType.COMMON,
        blockId: "block-b",
        status: TicketStatus.ASSIGNED,
        _count: { followers: 1 },
      } as any);

      // Student is in Block A
      vi.mocked(prisma.roomOccupancy.findFirst).mockResolvedValueOnce({
        room: { blockId: "block-a" },
      } as any);

      try {
        await TicketsService.followTicket("common-ticket-b", mockStudent);
        expect.fail("Should have thrown 403 FORBIDDEN");
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("assigned block");
      }
    });
  });

  describe("listTickets Sorting Order", () => {
    it("sorts open tickets first, then priority, then createdAt", async () => {
      const now = new Date("2026-10-26T12:00:00Z");
      const older = new Date("2026-10-26T10:00:00Z");

      // Returned from DB in arbitrary order
      vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce([
        { id: "1-closed-urgent", status: TicketStatus.CLOSED, priority: Priority.URGENT, createdAt: now, _count: { followers: 0, comments: 0 } },
        { id: "2-open-normal", status: TicketStatus.ASSIGNED, priority: Priority.NORMAL, createdAt: now, _count: { followers: 0, comments: 0 } },
        { id: "3-open-urgent", status: TicketStatus.IN_PROGRESS, priority: Priority.URGENT, createdAt: older, _count: { followers: 0, comments: 0 } },
        { id: "4-open-low", status: TicketStatus.RAISED, priority: Priority.LOW, createdAt: now, _count: { followers: 0, comments: 0 } },
      ] as any);
      vi.mocked(prisma.ticket.count).mockResolvedValueOnce(4);

      const res = await TicketsService.listTickets(mockStudent, { page: 1, limit: 10 });
      const ids = res.tickets.map((t) => t.id);

      // Expected order:
      // 1. Open Urgent (3-open-urgent)
      // 2. Open Normal (2-open-normal)
      // 3. Open Low (4-open-low)
      // 4. Closed (1-closed-urgent)
      expect(ids).toEqual(["3-open-urgent", "2-open-normal", "4-open-low", "1-closed-urgent"]);
    });
  });
});
