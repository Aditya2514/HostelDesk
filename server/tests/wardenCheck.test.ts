import { describe, it, expect, vi, beforeEach } from "vitest";
import { TicketStatus, LocationType, Role, CloseReason, EventType } from "@prisma/client";
import { TicketsService } from "../src/modules/tickets/tickets.service";

describe("Optional Warden Verification (Task 10)", () => {
  const wardenBlockA: any = {
    id: "warden-a",
    name: "Warden Mukherjee",
    role: Role.WARDEN,
    blockId: "block-a",
  };

  const wardenBlockB: any = {
    id: "warden-b",
    name: "Warden Sharma",
    role: Role.WARDEN,
    blockId: "block-b",
  };

  let mockTicket: any;
  let mockEvents: any[];
  let lockedState: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("../src/lib/prisma");

    mockTicket = {
      id: "ticket-601",
      code: "HD-0601",
      title: "Clogged shower drain",
      locationType: LocationType.ROOM,
      roomId: "room-601",
      blockId: "block-a",
      status: TicketStatus.CLOSED,
      closeReason: CloseReason.CONFIRMED,
      resolvedAt: new Date(Date.now() - 3 * 3600 * 1000),
      closedAt: new Date(Date.now() - 2 * 3600 * 1000),
      reopenCount: 0,
      assignedToId: "staff-ramesh",
      categoryId: "cat-plumb",
      priority: "NORMAL",
      createdAt: new Date(Date.now() - 24 * 3600 * 1000),
      category: { id: "cat-plumb", name: "Plumbing" },
    };

    mockEvents = [];
    lockedState = { ...mockTicket };

    vi.spyOn(prisma.ticket, "findUnique").mockImplementation(async ({ where }: any) => {
      if (where.id === "ticket-601") return mockTicket;
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
        category: {
          findUnique: vi.fn().mockResolvedValue({ trade: "PLUMBING" }),
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

  it("rejects non-closed tickets with 400 INVALID_STATE", async () => {
    mockTicket.status = TicketStatus.IN_PROGRESS;
    await expect(
      TicketsService.wardenCheck("ticket-601", wardenBlockA, { result: "OK" })
    ).rejects.toThrow("Only closed tickets can undergo warden verification");
  });

  it("rejects warden from another block with 403 FORBIDDEN", async () => {
    await expect(
      TicketsService.wardenCheck("ticket-601", wardenBlockB, { result: "OK" })
    ).rejects.toThrow("Wardens can only verify tickets in their assigned block");
  });

  it("requires note when result is PROBLEM", async () => {
    await expect(
      TicketsService.wardenCheck("ticket-601", wardenBlockA, { result: "PROBLEM", note: "   " })
    ).rejects.toThrow("A note is required when marking a problem found");
  });

  it("records WARDEN_VERIFIED event when result is OK, keeping ticket CLOSED", async () => {
    const res = await TicketsService.wardenCheck("ticket-601", wardenBlockA, {
      result: "OK",
      note: "Inspected bathroom, water flows cleanly",
    });

    expect(res.status).toBe(TicketStatus.CLOSED);
    expect(res.result).toBe("OK");
    expect(mockTicket.status).toBe(TicketStatus.CLOSED);

    const event = mockEvents.find((e) => e.type === EventType.WARDEN_VERIFIED);
    expect(event).toBeDefined();
    expect(event.note).toContain("Inspected bathroom, water flows cleanly");
  });

  it("reopens ticket, increments reopenCount, and re-routes when result is PROBLEM", async () => {
    const res = await TicketsService.wardenCheck("ticket-601", wardenBlockA, {
      result: "PROBLEM",
      note: "Drain still drains too slowly, water pools up",
    });

    expect(res.result).toBe("PROBLEM");
    expect(res.reopenCount).toBe(1);
    expect(mockTicket.reopenCount).toBe(1);
    expect(mockTicket.closedAt).toBeNull();
    expect(mockTicket.closeReason).toBeNull();
    expect(mockTicket.resolvedAt).toBeNull();
    expect([TicketStatus.REOPENED, TicketStatus.ASSIGNED, TicketStatus.RAISED]).toContain(
      mockTicket.status
    );

    const event = mockEvents.find(
      (e) => e.type === EventType.STATUS_CHANGED && e.toStatus === TicketStatus.REOPENED
    );
    expect(event).toBeDefined();
    expect(event.note).toContain("Drain still drains too slowly");
  });
});
