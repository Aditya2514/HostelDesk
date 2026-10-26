import { describe, it, expect, vi, beforeEach } from "vitest";
import { TicketStatus, LocationType, Role, AttachmentKind, ResolutionMethod, EventType } from "@prisma/client";
import { TicketsService } from "../src/modules/tickets/tickets.service";
import { AppError } from "../src/lib/errors";

describe("Ticket Resolution & Code Verification (Task 5)", () => {
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
  let mockAttachments: any[];
  let mockEvents: any[];
  let lockedState: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("../src/lib/prisma");

    mockTicket = {
      id: "ticket-101",
      code: "HD-0101",
      title: "Broken tap",
      locationType: LocationType.ROOM,
      status: TicketStatus.IN_PROGRESS,
      assignedToId: "staff-ramesh",
      startedAt: new Date(Date.now() - 3600000), // started 60 mins ago
      category: { id: "cat-plumbing", name: "Plumbing" },
    };

    mockAttachments = [
      {
        id: "att-1",
        ticketId: "ticket-101",
        kind: AttachmentKind.AFTER,
        uploaderId: "staff-ramesh",
        createdAt: new Date(Date.now() - 600000), // uploaded 10 mins ago
      },
    ];

    mockEvents = [
      {
        fromStatus: TicketStatus.ASSIGNED,
        toStatus: TicketStatus.IN_PROGRESS,
        createdAt: new Date(Date.now() - 3600000),
      },
    ];

    lockedState = {
      id: "ticket-101",
      completionCode: "1234",
      codeFailedAttempts: 0,
      codeBlockedUntil: null,
      status: TicketStatus.IN_PROGRESS,
      locationType: LocationType.ROOM,
    };

    vi.spyOn(prisma.ticket, "findUnique").mockImplementation(async ({ where }: any) => {
      if (where.id === "ticket-101") return mockTicket;
      return null;
    });

    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      const tx = {
        attachment: {
          findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
            return mockAttachments.find(
              (a) =>
                a.ticketId === where.ticketId &&
                a.kind === where.kind &&
                a.uploaderId === where.uploaderId &&
                a.createdAt >= where.createdAt.gte
            );
          }),
        },
        $queryRaw: vi.fn().mockImplementation(async () => {
          return [lockedState];
        }),
        ticket: {
          findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
            if (where.id === "ticket-101") return mockTicket;
            return null;
          }),
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
          findMany: vi.fn().mockImplementation(async () => {
            return mockEvents;
          }),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([]),
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

  it("fails if non-assigned staff attempts to resolve", async () => {
    await expect(TicketsService.resolveTicket("ticket-101", otherStaffUser, "1234")).rejects.toThrow(
      "Only the assigned staff member can resolve this ticket"
    );
  });

  it("fails if ticket is not IN_PROGRESS", async () => {
    mockTicket.status = TicketStatus.ASSIGNED;
    await expect(TicketsService.resolveTicket("ticket-101", staffUser, "1234")).rejects.toThrow(
      "Ticket must be in progress to be marked resolved"
    );
  });

  it("requires an AFTER photo uploaded by assigned staff", async () => {
    mockAttachments = []; // no after photo
    await expect(TicketsService.resolveTicket("ticket-101", staffUser, "1234")).rejects.toThrow(
      "At least one AFTER photo is required"
    );
  });

  it("requires completion code for ROOM tickets", async () => {
    await expect(TicketsService.resolveTicket("ticket-101", staffUser, "")).rejects.toThrow(
      "Completion code is required for room tickets"
    );
  });

  it("tracks failed code attempts and locks after 5 attempts", async () => {
    // Attempts 1 to 4 should give INVALID_CODE with remaining count
    for (let i = 1; i <= 4; i++) {
      try {
        await TicketsService.resolveTicket("ticket-101", staffUser, "9999");
        expect.fail("Should throw invalid code");
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe("INVALID_CODE");
        expect(err.message).toContain(`${5 - i} attempt(s) remaining`);
      }
    }

    // 5th attempt should lock the ticket for 15 minutes with 429 CODE_LOCKED
    try {
      await TicketsService.resolveTicket("ticket-101", staffUser, "9999");
      expect.fail("Should throw code locked");
    } catch (err: any) {
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe("CODE_LOCKED");
      expect(lockedState.codeBlockedUntil).not.toBeNull();
    }

    // Subsequent attempt while locked rejects immediately
    try {
      await TicketsService.resolveTicket("ticket-101", staffUser, "1234");
      expect.fail("Should reject while locked");
    } catch (err: any) {
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe("CODE_LOCKED");
    }
  });

  it("resolves ROOM ticket with valid code, clears code, records CODE_VERIFIED, and sets actualWorkMinutes", async () => {
    const result = await TicketsService.resolveTicket("ticket-101", staffUser, "1234");

    expect(result.status).toBe(TicketStatus.RESOLVED);
    expect(result.resolutionMethod).toBe(ResolutionMethod.CODE);
    expect(result.completionCode).toBeNull();
    expect(result.actualWorkMinutes).toBeGreaterThanOrEqual(59);

    // Verify CODE_VERIFIED event was created
    const codeVerifiedEvent = mockEvents.find((e) => e.type === EventType.CODE_VERIFIED);
    expect(codeVerifiedEvent).toBeDefined();
  });

  it("resolves COMMON area ticket to AWAITING_VERIFICATION without needing a code", async () => {
    mockTicket.locationType = LocationType.COMMON;
    lockedState.locationType = LocationType.COMMON;

    const result = await TicketsService.resolveTicket("ticket-101", staffUser);

    expect(result.status).toBe(TicketStatus.AWAITING_VERIFICATION);
    expect(result.resolutionMethod).toBe(ResolutionMethod.PHOTO);
    expect(result.actualWorkMinutes).toBeGreaterThanOrEqual(59);
  });
});
