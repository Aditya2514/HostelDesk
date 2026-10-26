import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TicketStatus,
  LocationType,
  Role,
  AttachmentKind,
  DisputeType,
  DisputeStatus,
  EventType,
} from "@prisma/client";
import { TicketsService } from "../src/modules/tickets/tickets.service";
import { simulateQueue } from "../src/modules/scheduling/simulator";
import { AppError } from "../src/lib/errors";

describe("Locked Room Flow & Access Management (Task 7)", () => {
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

  const occupantUser: any = {
    id: "student-1",
    name: "Arjun Verma",
    role: Role.STUDENT,
    currentRoomId: "room-301",
  };

  let mockTicket: any;
  let mockAttachments: any[];
  let mockEvents: any[];
  let mockDisputes: any[];
  let mockShifts: any[];
  let lockedState: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("../src/lib/prisma");

    mockTicket = {
      id: "ticket-301",
      code: "HD-0301",
      title: "Geyser not heating",
      locationType: LocationType.ROOM,
      roomId: "room-301",
      raisedById: "student-1",
      status: TicketStatus.IN_PROGRESS,
      assignedToId: "staff-ramesh",
      lockedVisitCount: 0,
      pausedAt: null,
      totalPausedMinutes: 0,
      dueAt: new Date(Date.now() + 24 * 3600 * 1000),
      preferredSlotStart: null,
      preferredSlotEnd: null,
      priorityBoostUntil: null,
      blockId: "block-a",
      category: { id: "cat-elec", name: "Electrical" },
    };

    mockAttachments = [
      {
        id: "att-door",
        ticketId: "ticket-301",
        kind: AttachmentKind.DOOR,
        uploaderId: "staff-ramesh",
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // uploaded 5 minutes ago
      },
    ];

    mockEvents = [];
    mockDisputes = [];
    lockedState = { ...mockTicket };

    // Staff shifts: Mon-Sat 09:00 - 18:00 (540 to 1080)
    mockShifts = [0, 1, 2, 3, 4, 5, 6].map((w) => ({
      weekday: w,
      startMinute: 540,
      endMinute: 1080,
    }));

    vi.spyOn(prisma.ticket, "findUnique").mockImplementation(async ({ where }: any) => {
      if (where.id === "ticket-301") return mockTicket;
      return null;
    });

    vi.spyOn(prisma.user, "findUnique").mockImplementation(async ({ where }: any) => {
      if (where.id === "staff-ramesh") {
        return {
          id: "staff-ramesh",
          name: "Ramesh Kumar",
          shifts: mockShifts,
        };
      }
      return null;
    });

    vi.spyOn(prisma.roomOccupancy, "findFirst").mockImplementation(async ({ where }: any) => {
      if (where.roomId === "room-301" && where.userId === "student-1") {
        return { id: "occ-1", roomId: "room-301", userId: "student-1" };
      }
      return null;
    });

    vi.spyOn(prisma.ticketFollower, "findUnique").mockResolvedValue(null);

    vi.spyOn(prisma.attachment, "findFirst").mockImplementation(async ({ where }: any) => {
      return mockAttachments.find(
        (a) =>
          a.ticketId === where.ticketId &&
          a.kind === where.kind &&
          a.uploaderId === where.uploaderId &&
          a.createdAt >= where.createdAt.gte
      );
    });

    vi.spyOn(prisma.ticket, "findMany").mockResolvedValue([]);

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
        dispute: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            const row = { id: `disp-${mockDisputes.length + 1}`, ...data };
            mockDisputes.push(row);
            return row;
          }),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([{ id: "warden-1" }]),
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

  describe("reportRoomLocked", () => {
    it("rejects non-assigned staff member", async () => {
      await expect(TicketsService.reportRoomLocked("ticket-301", otherStaffUser)).rejects.toThrow(
        "Only the assigned staff member can report room locked"
      );
    });

    it("rejects common area tickets", async () => {
      mockTicket.locationType = LocationType.COMMON;
      await expect(TicketsService.reportRoomLocked("ticket-301", staffUser)).rejects.toThrow(
        "Room locked report is only applicable to room tickets"
      );
    });

    it("rejects if door photo was not uploaded within last 30 minutes", async () => {
      mockAttachments = []; // no recent door photo
      await expect(TicketsService.reportRoomLocked("ticket-301", staffUser)).rejects.toThrow(
        "A door photo uploaded within the last 30 minutes is required"
      );
    });

    it("transitions to AWAITING_ACCESS, increments lockedVisitCount, and pauses SLA", async () => {
      const res = await TicketsService.reportRoomLocked("ticket-301", staffUser);

      expect(res.status).toBe(TicketStatus.AWAITING_ACCESS);
      expect(res.lockedVisitCount).toBe(1);
      expect(mockTicket.status).toBe(TicketStatus.AWAITING_ACCESS);
      expect(mockTicket.pausedAt).not.toBeNull();

      const event = mockEvents.find((e) => e.type === EventType.ROOM_LOCKED);
      expect(event).toBeDefined();
    });
  });

  describe("getAccessSlots", () => {
    it("returns available 30-minute slots during staff working shifts", async () => {
      const res = await TicketsService.getAccessSlots("ticket-301", occupantUser);

      expect(Array.isArray(res.slots)).toBe(true);
      expect(res.slots.length).toBeGreaterThan(0);
      expect(res.slots[0]).toHaveProperty("start");
      expect(res.slots[0]).toHaveProperty("end");
      expect(res.slots[0]).toHaveProperty("label");
    });
  });

  describe("respondAccess & 15-minute boost", () => {
    beforeEach(() => {
      mockTicket.status = TicketStatus.AWAITING_ACCESS;
      mockTicket.pausedAt = new Date(Date.now() - 3600000); // paused 1 hour ago
    });

    it("allows COMING_15 on 1st locked visit, setting priorityBoostUntil and resuming SLA", async () => {
      mockTicket.lockedVisitCount = 1;

      const res = await TicketsService.respondAccess("ticket-301", occupantUser, {
        option: "COMING_15",
      });

      expect(res.status).toBe(TicketStatus.ASSIGNED);
      expect(res.priorityBoostUntil).not.toBeNull();
      expect(mockTicket.pausedAt).toBeNull();
      expect(mockTicket.totalPausedMinutes).toBeGreaterThanOrEqual(59);

      const event = mockEvents.find((e) => e.type === EventType.ACCESS_RESPONDED);
      expect(event).toBeDefined();
    });

    it("rejects COMING_15 on 2nd locked visit, requiring a time slot", async () => {
      mockTicket.lockedVisitCount = 2;

      await expect(
        TicketsService.respondAccess("ticket-301", occupantUser, { option: "COMING_15" })
      ).rejects.toThrow("On the 2nd locked visit, you must pick a time slot");
    });

    it("allows SLOT option, setting preferredSlotStart/End and resuming SLA", async () => {
      mockTicket.lockedVisitCount = 2;
      const futureSlot = new Date(Date.now() + 4 * 3600 * 1000).toISOString();

      const res = await TicketsService.respondAccess("ticket-301", occupantUser, {
        option: "SLOT",
        slotStart: futureSlot,
      });

      expect(res.status).toBe(TicketStatus.ASSIGNED);
      expect(res.preferredSlotStart).toEqual(new Date(futureSlot));
      expect(mockTicket.pausedAt).toBeNull();
    });

    it("simulator places priorityBoostUntil job at the top of ready queue", () => {
      const now = new Date("2026-10-26T10:00:00.000Z");
      const shifts = [{ weekday: 1, startMinute: 540, endMinute: 1080 }]; // 09:00 - 18:00

      // Job A: normal job created earlier
      const jobA: any = {
        ticketId: "job-normal",
        priority: "NORMAL",
        createdAt: new Date("2026-10-26T08:00:00.000Z"),
        durationMinutes: 30,
        status: "ASSIGNED",
      };

      // Job B: boosted job with priorityBoostUntil active for next 15 min
      const jobB: any = {
        ticketId: "job-boosted",
        priority: "NORMAL",
        createdAt: new Date("2026-10-26T09:30:00.000Z"),
        durationMinutes: 30,
        status: "ASSIGNED",
        priorityBoostUntil: new Date("2026-10-26T10:15:00.000Z"),
      };

      const result = simulateQueue({
        now,
        shifts,
        jobs: [jobA, jobB],
      });

      const schedA = result.get("job-normal")!;
      const schedB = result.get("job-boosted")!;

      // Boosted job must start before normal job!
      expect(schedB.startAt.getTime()).toBeLessThan(schedA.startAt.getTime());
    });
  });

  describe("disputeLockedClaim", () => {
    it("creates an OPEN Dispute of type LOCKED_CLAIM_FALSE and notifies warden", async () => {
      mockTicket.status = TicketStatus.AWAITING_ACCESS;
      mockTicket.lockedVisitCount = 1;

      const res = await TicketsService.disputeLockedClaim(
        "ticket-301",
        occupantUser,
        "I was in my room the entire time; staff never knocked"
      );

      expect(res.success).toBe(true);
      expect(res.status).toBe(DisputeStatus.OPEN);

      expect(mockDisputes.length).toBe(1);
      expect(mockDisputes[0].type).toBe(DisputeType.LOCKED_CLAIM_FALSE);
      expect(mockDisputes[0].status).toBe(DisputeStatus.OPEN);

      const event = mockEvents.find((e) => e.type === EventType.DISPUTE_RAISED);
      expect(event).toBeDefined();
    });
  });
});
