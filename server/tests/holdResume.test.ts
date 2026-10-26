import { describe, it, expect, vi, beforeEach } from "vitest";
import { TicketStatus, LocationType, Role, EventType } from "@prisma/client";
import { TicketsService } from "../src/modules/tickets/tickets.service";

describe("On Hold & Resume with SLA Accounting (Task 8)", () => {
  const staffUser: any = {
    id: "staff-ramesh",
    name: "Ramesh Kumar",
    role: Role.STAFF,
  };

  const otherStaffUser: any = {
    id: "staff-suresh",
    name: "Suresh Sharma",
    role: Role.STAFF,
  };

  let mockTicket: any;
  let mockEvents: any[];
  let lockedState: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("../src/lib/prisma");

    const initialDueAt = new Date(Date.now() + 24 * 3600 * 1000);

    mockTicket = {
      id: "ticket-401",
      code: "HD-0401",
      title: "Water pipe leaking",
      locationType: LocationType.ROOM,
      roomId: "room-401",
      status: TicketStatus.IN_PROGRESS,
      assignedToId: "staff-ramesh",
      pausedAt: null,
      totalPausedMinutes: 0,
      dueAt: initialDueAt,
      completionCode: "1111",
      category: { id: "cat-plumb", name: "Plumbing" },
    };

    mockEvents = [];
    lockedState = { ...mockTicket };

    vi.spyOn(prisma.ticket, "findUnique").mockImplementation(async ({ where }: any) => {
      if (where.id === "ticket-401") return mockTicket;
      return null;
    });

    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      const tx = {
        $queryRaw: vi.fn().mockImplementation(async () => [lockedState]),
        ticket: {
          findUnique: vi.fn().mockImplementation(async () => mockTicket),
          update: vi.fn().mockImplementation(async ({ data }: any) => {
            Object.assign(lockedState, data);
            Object.assign(mockTicket, data);
            return { ...mockTicket, ...data };
          }),
        },
        ticketEvent: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            mockEvents.push(data);
            return data;
          }),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue(null),
        },
        roomOccupancy: {
          findMany: vi.fn().mockResolvedValue([{ userId: "student-1" }]),
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

  describe("holdTicket", () => {
    it("rejects non-assigned staff member", async () => {
      await expect(
        TicketsService.holdTicket("ticket-401", otherStaffUser, "Waiting for pipe fitting")
      ).rejects.toThrow("Only the assigned staff member can put this ticket on hold");
    });

    it("requires a non-empty reason", async () => {
      await expect(TicketsService.holdTicket("ticket-401", staffUser, "   ")).rejects.toThrow(
        "Reason is required to put a ticket on hold"
      );
    });

    it("rejects tickets that are not IN_PROGRESS", async () => {
      mockTicket.status = TicketStatus.ASSIGNED;
      await expect(
        TicketsService.holdTicket("ticket-401", staffUser, "Waiting for part")
      ).rejects.toThrow("Ticket must be in progress to be put on hold");
    });

    it("transitions ticket to ON_HOLD, sets pausedAt, and logs ON_HOLD event", async () => {
      const res = await TicketsService.holdTicket("ticket-401", staffUser, "Waiting for 1/2 inch valve");

      expect(res.status).toBe(TicketStatus.ON_HOLD);
      expect(res.pausedAt).not.toBeNull();
      expect(mockTicket.status).toBe(TicketStatus.ON_HOLD);
      expect(mockTicket.pausedAt).not.toBeNull();

      const event = mockEvents.find((e) => e.type === EventType.ON_HOLD);
      expect(event).toBeDefined();
      expect(event.note).toContain("Waiting for 1/2 inch valve");
    });
  });

  describe("resumeTicket", () => {
    it("rejects non-assigned staff member", async () => {
      mockTicket.status = TicketStatus.ON_HOLD;
      await expect(TicketsService.resumeTicket("ticket-401", otherStaffUser)).rejects.toThrow(
        "Only the assigned staff member can resume this ticket"
      );
    });

    it("rejects tickets that are not ON_HOLD", async () => {
      mockTicket.status = TicketStatus.IN_PROGRESS;
      await expect(TicketsService.resumeTicket("ticket-401", staffUser)).rejects.toThrow(
        "Ticket must be on hold to be resumed"
      );
    });

    it("resumes ticket: extends dueAt by paused duration, clears pausedAt, transitions to IN_PROGRESS", async () => {
      // Put on hold 2 hours ago
      const initialDueAt = new Date(Date.now() + 24 * 3600 * 1000);
      mockTicket.status = TicketStatus.ON_HOLD;
      mockTicket.dueAt = initialDueAt;
      mockTicket.pausedAt = new Date(Date.now() - 2 * 3600 * 1000);
      mockTicket.totalPausedMinutes = 0;

      const res = await TicketsService.resumeTicket("ticket-401", staffUser);

      expect(res.status).toBe(TicketStatus.IN_PROGRESS);
      expect(mockTicket.status).toBe(TicketStatus.IN_PROGRESS);
      expect(mockTicket.pausedAt).toBeNull();
      expect(res.totalPausedMinutes).toBeGreaterThanOrEqual(119);
      expect(res.totalPausedMinutes).toBeLessThanOrEqual(121);

      // dueAt was extended by ~120 minutes
      const diffMs = res.dueAt.getTime() - initialDueAt.getTime();
      expect(diffMs).toBeGreaterThanOrEqual(119 * 60 * 1000);

      const event = mockEvents.find((e) => e.type === EventType.RESUMED);
      expect(event).toBeDefined();
    });
  });
});
