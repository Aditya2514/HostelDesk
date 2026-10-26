import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TicketStatus,
  LocationType,
  Role,
  CloseReason,
  DisputeType,
  DisputeStatus,
  EventType,
} from "@prisma/client";
import { TicketsService } from "../src/modules/tickets/tickets.service";
import { AppError } from "../src/lib/errors";
import { clock } from "../src/lib/clock";

describe("Confirm & Dispute Flows with Dispute-Wins Rule (Task 6)", () => {
  const occupantA: any = {
    id: "student-a",
    name: "Roommate A",
    role: Role.STUDENT,
    currentRoomId: "room-204",
  };

  const occupantB: any = {
    id: "student-b",
    name: "Roommate B",
    role: Role.STUDENT,
    currentRoomId: "room-204",
  };

  const outsiderStudent: any = {
    id: "student-c",
    name: "Student Other Room",
    role: Role.STUDENT,
    currentRoomId: "room-999",
  };

  let mockTicket: any;
  let mockEvents: any[];
  let mockDisputes: any[];
  let lockedState: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("../src/lib/prisma");

    const resolvedTime = new Date(Date.now() - 2 * 3600 * 1000); // 2 hours ago

    mockTicket = {
      id: "ticket-204",
      code: "HD-0204",
      title: "Fan regulator broken",
      locationType: LocationType.ROOM,
      roomId: "room-204",
      raisedById: "student-a",
      status: TicketStatus.RESOLVED,
      closeReason: null,
      resolvedAt: resolvedTime,
      closedAt: null,
      reopenCount: 0,
      assignedToId: "staff-ramesh",
      categoryId: "cat-elec",
      blockId: "block-a",
      priority: "NORMAL",
      createdAt: new Date(Date.now() - 24 * 3600 * 1000),
      category: { id: "cat-elec", name: "Electrical" },
    };

    mockEvents = [];
    mockDisputes = [];

    lockedState = { ...mockTicket };

    vi.spyOn(prisma.ticket, "findUnique").mockImplementation(async ({ where }: any) => {
      if (where.id === "ticket-204") return mockTicket;
      return null;
    });

    vi.spyOn(prisma.roomOccupancy, "findFirst").mockImplementation(async ({ where }: any) => {
      if (where.roomId === "room-204" && (where.userId === "student-a" || where.userId === "student-b")) {
        return { id: "occ-1", roomId: "room-204", userId: where.userId };
      }
      return null;
    });

    vi.spyOn(prisma.ticketFollower, "findUnique").mockResolvedValue(null);

    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      const tx = {
        $queryRaw: vi.fn().mockImplementation(async () => {
          return [lockedState];
        }),
        ticket: {
          findUnique: vi.fn().mockImplementation(async () => mockTicket),
          update: vi.fn().mockImplementation(async ({ data }: any) => {
            Object.assign(lockedState, data);
            Object.assign(mockTicket, data);
            return { ...mockTicket, ...data };
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        ticketEvent: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            mockEvents.push(data);
            return data;
          }),
        },
        dispute: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            const row = { id: `disp-${mockDisputes.length + 1}`, ...data };
            mockDisputes.push(row);
            return row;
          }),
        },
        roomOccupancy: {
          findMany: vi.fn().mockResolvedValue([{ userId: "student-a" }, { userId: "student-b" }]),
        },
        category: {
          findUnique: vi.fn().mockResolvedValue({ trade: "ELECTRICAL" }),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue(null),
        },
        ticketFollower: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        notification: {
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      return callback(tx);
    });
  });

  describe("Confirmation", () => {
    it("rejects non-occupant student from confirming", async () => {
      await expect(TicketsService.confirmTicket("ticket-204", outsiderStudent)).rejects.toThrow(
        "Only room occupants or ticket reporters can perform this action"
      );
    });

    it("confirms a RESOLVED room ticket, transitioning to CLOSED with CONFIRMED", async () => {
      const res = await TicketsService.confirmTicket("ticket-204", occupantA);
      expect(res.status).toBe(TicketStatus.CLOSED);
      expect(res.closeReason).toBe(CloseReason.CONFIRMED);
      expect(mockTicket.status).toBe(TicketStatus.CLOSED);
      expect(mockTicket.closeReason).toBe(CloseReason.CONFIRMED);

      const confirmEvent = mockEvents.find((e) => e.type === EventType.CONFIRMED);
      expect(confirmEvent).toBeDefined();
    });

    it("returns idempotent success if already confirmed", async () => {
      mockTicket.status = TicketStatus.CLOSED;
      mockTicket.closeReason = CloseReason.CONFIRMED;
      lockedState.status = TicketStatus.CLOSED;
      lockedState.closeReason = CloseReason.CONFIRMED;

      const res = await TicketsService.confirmTicket("ticket-204", occupantA);
      expect(res.status).toBe(TicketStatus.CLOSED);
      expect(res.closeReason).toBe(CloseReason.CONFIRMED);
    });

    it("rejects confirming a ticket that is IN_PROGRESS", async () => {
      mockTicket.status = TicketStatus.IN_PROGRESS;
      lockedState.status = TicketStatus.IN_PROGRESS;

      await expect(TicketsService.confirmTicket("ticket-204", occupantA)).rejects.toThrow();
    });
  });

  describe("Dispute & Dispute-Wins Rule", () => {
    it("requires a non-empty dispute reason", async () => {
      await expect(TicketsService.disputeTicket("ticket-204", occupantA, "   ")).rejects.toThrow(
        "Dispute reason is required"
      );
    });

    it("rejects non-occupant student from disputing", async () => {
      await expect(
        TicketsService.disputeTicket("ticket-204", outsiderStudent, "Not fixed properly")
      ).rejects.toThrow("Only room occupants or ticket reporters can perform this action");
    });

    it("rejects dispute if 48h dispute window has elapsed", async () => {
      // Set resolvedAt to 49 hours ago
      const oldTime = new Date(Date.now() - 49 * 3600 * 1000);
      mockTicket.resolvedAt = oldTime;
      lockedState.resolvedAt = oldTime;

      try {
        await TicketsService.disputeTicket("ticket-204", occupantA, "Still sparking");
        expect.fail("Should throw dispute window closed");
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe("DISPUTE_WINDOW_CLOSED");
      }
    });

    it("disputes a RESOLVED ticket within 48h, recording Dispute row, incrementing reopenCount, and reopening", async () => {
      const res = await TicketsService.disputeTicket("ticket-204", occupantA, "Fan still wobbles");

      expect(res.success).toBe(true);
      expect(res.reopenCount).toBe(1);
      expect(mockTicket.reopenCount).toBe(1);
      expect(mockTicket.resolvedAt).toBeNull();

      // Dispute row created
      expect(mockDisputes.length).toBe(1);
      expect(mockDisputes[0].type).toBe(DisputeType.FIX_NOT_DONE);
      expect(mockDisputes[0].reason).toBe("Fan still wobbles");
      expect(mockDisputes[0].status).toBe(DisputeStatus.UPHELD);

      // Event logged
      const disputeEvent = mockEvents.find((e) => e.type === EventType.DISPUTED);
      expect(disputeEvent).toBeDefined();
    });

    it("Dispute always wins: Roommate A confirms to CLOSED, Roommate B disputes within 48h -> ticket reopens", async () => {
      // 1. Roommate A confirms ticket -> CLOSED with CONFIRMED
      const confirmRes = await TicketsService.confirmTicket("ticket-204", occupantA);
      expect(confirmRes.status).toBe(TicketStatus.CLOSED);
      expect(mockTicket.status).toBe(TicketStatus.CLOSED);

      // 2. Roommate B discovers problem and disputes within 48h
      const disputeRes = await TicketsService.disputeTicket(
        "ticket-204",
        occupantB,
        "It made a loud noise and stopped spinning"
      );

      // Dispute wins!
      expect(disputeRes.success).toBe(true);
      expect(disputeRes.reopenCount).toBe(1);
      expect(mockTicket.reopenCount).toBe(1);
      expect(mockTicket.closeReason).toBeNull();
      expect(mockTicket.closedAt).toBeNull();
      expect([TicketStatus.REOPENED, TicketStatus.ASSIGNED, TicketStatus.RAISED]).toContain(
        mockTicket.status
      );
    });
  });
});
