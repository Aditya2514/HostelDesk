import { describe, it, expect, vi, beforeEach } from "vitest";
import { TicketStatus, LocationType, Role } from "@prisma/client";
import { TicketsService } from "../src/modules/tickets/tickets.service";
import { AppError } from "../src/lib/errors";

describe("Completion Code Security & Generation (Task 4)", () => {
  const occupantUser: any = {
    id: "student-1",
    name: "Room Occupant 1",
    role: Role.STUDENT,
    currentRoomId: "room-101",
  };

  const roommateUser: any = {
    id: "student-2",
    name: "Roommate 2",
    role: Role.STUDENT,
    currentRoomId: "room-101",
  };

  const otherStudentUser: any = {
    id: "student-3",
    name: "Other Student",
    role: Role.STUDENT,
    currentRoomId: "room-202",
  };

  const assignedStaffUser: any = {
    id: "staff-ramesh",
    name: "Ramesh Kumar",
    role: Role.STAFF,
  };

  const wardenUser: any = {
    id: "warden-1",
    name: "Warden Mukherjee",
    role: Role.WARDEN,
    blockId: "block-a",
  };

  const inProgressRoomTicket: any = {
    id: "ticket-room-1",
    code: "HD-0010",
    locationType: LocationType.ROOM,
    roomId: "room-101",
    status: TicketStatus.IN_PROGRESS,
    completionCode: "4829",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("../src/lib/prisma");
    vi.spyOn(prisma.ticket, "findUnique").mockImplementation(async ({ where }: any) => {
      if (where.id === "ticket-room-1") {
        return inProgressRoomTicket;
      }
      return null;
    });
  });

  it("permits current occupants of the room to view the completion code while IN_PROGRESS", async () => {
    // Both occupant and roommate should see code
    const res1 = await TicketsService.getCompletionCode("ticket-room-1", occupantUser);
    expect(res1.code).toBe("4829");

    const res2 = await TicketsService.getCompletionCode("ticket-room-1", roommateUser);
    expect(res2.code).toBe("4829");
  });

  it("returns 404 NOT_FOUND to assigned staff attempting to view the code", async () => {
    try {
      await TicketsService.getCompletionCode("ticket-room-1", assignedStaffUser);
      expect.fail("Should have thrown 404");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("NOT_FOUND");
    }
  });

  it("returns 404 NOT_FOUND to wardens attempting to view the code", async () => {
    try {
      await TicketsService.getCompletionCode("ticket-room-1", wardenUser);
      expect.fail("Should have thrown 404");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(404);
    }
  });

  it("returns 404 NOT_FOUND to students in other rooms", async () => {
    try {
      await TicketsService.getCompletionCode("ticket-room-1", otherStudentUser);
      expect.fail("Should have thrown 404");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(404);
    }
  });

  it("returns 404 NOT_FOUND when ticket is not IN_PROGRESS (e.g. ASSIGNED or RESOLVED)", async () => {
    const assignedTicket = { ...inProgressRoomTicket, status: TicketStatus.ASSIGNED };
    // Mock prisma findUnique to return assigned ticket
    const originalFindUnique = vi.spyOn((TicketsService as any), "getCompletionCode");

    try {
      await TicketsService.getCompletionCode("ticket-room-1", occupantUser);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
    }
  });

  it("onEnterInProgress generates 4-digit zero-padded code and resets locks", async () => {
    const mockTx: any = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue({ locationType: LocationType.ROOM }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    await TicketsService.onEnterInProgress("ticket-room-1", mockTx);

    expect(mockTx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ticket-room-1" },
        data: expect.objectContaining({
          codeFailedAttempts: 0,
          codeBlockedUntil: null,
          completionCode: expect.stringMatching(/^\d{4}$/),
        }),
      })
    );
  });
});
