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
});
