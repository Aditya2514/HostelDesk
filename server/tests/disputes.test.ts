import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TicketStatus,
  LocationType,
  Role,
  CloseReason,
  ResolutionMethod,
  DisputeType,
  DisputeStatus,
  EventType,
} from "@prisma/client";
import { TicketsService } from "../src/modules/tickets/tickets.service";
import { DisputesService } from "../src/modules/disputes/disputes.service";

describe("Code-Refusal and False-Lock Disputes with Warden Decisions (Task 9)", () => {
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

  const wardenBlockA: any = {
    id: "warden-a",
    name: "Warden Block A",
    role: Role.WARDEN,
    blockId: "block-a",
  };

  const wardenBlockB: any = {
    id: "warden-b",
    name: "Warden Block B",
    role: Role.WARDEN,
    blockId: "block-b",
  };

  const chiefWarden: any = {
    id: "chief-1",
    name: "Chief Warden",
    role: Role.CHIEF_WARDEN,
  };

  let mockTicket: any;
  let mockDisputes: any[];
  let mockEvents: any[];

  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("../src/lib/prisma");

    mockTicket = {
      id: "ticket-501",
      code: "HD-0501",
      title: "Broken window latch",
      locationType: LocationType.ROOM,
      roomId: "room-501",
      blockId: "block-a",
      status: TicketStatus.IN_PROGRESS,
      assignedToId: "staff-ramesh",
      completionCode: "7777",
      startedAt: new Date(Date.now() - 45 * 60 * 1000), // 45 min ago
      category: { id: "cat-carp", name: "Carpentry" },
      pausedAt: null,
      totalPausedMinutes: 0,
      dueAt: new Date(Date.now() + 24 * 3600 * 1000),
    };

    mockDisputes = [];
    mockEvents = [];

    vi.spyOn(prisma.ticket, "findUnique").mockImplementation(async ({ where }: any) => {
      if (where.id === "ticket-501") return mockTicket;
      return null;
    });

    vi.spyOn(prisma.dispute, "findUnique").mockImplementation(async ({ where }: any) => {
      const disp = mockDisputes.find((d) => d.id === where.id);
      if (!disp) return null;
      return {
        ...disp,
        ticket: mockTicket,
      };
    });

    vi.spyOn(prisma.dispute, "findMany").mockImplementation(async ({ where }: any) => {
      return mockDisputes.filter((d) => {
        if (where?.ticket?.blockId && mockTicket.blockId !== where.ticket.blockId) return false;
        if (where?.status && d.status !== where.status) return false;
        return true;
      });
    });

    vi.spyOn(prisma.user, "findMany").mockResolvedValue([{ id: "warden-a" }]);

    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      const tx = {
        dispute: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            const row = { id: `disp-${mockDisputes.length + 1}`, ...data };
            mockDisputes.push(row);
            return row;
          }),
          update: vi.fn().mockImplementation(async ({ where, data }: any) => {
            const idx = mockDisputes.findIndex((d) => d.id === where.id);
            if (idx >= 0) {
              Object.assign(mockDisputes[idx], data);
              return mockDisputes[idx];
            }
            return data;
          }),
        },
        ticket: {
          findUnique: vi.fn().mockImplementation(async () => mockTicket),
          update: vi.fn().mockImplementation(async ({ data }: any) => {
            Object.assign(mockTicket, data);
            return mockTicket;
          }),
        },
        ticketEvent: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            mockEvents.push(data);
            return data;
          }),
          findMany: vi.fn().mockImplementation(async () => [
            {
              fromStatus: TicketStatus.ASSIGNED,
              toStatus: TicketStatus.IN_PROGRESS,
              createdAt: mockTicket.startedAt,
            },
          ]),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([{ id: "warden-a" }]),
          findFirst: vi.fn().mockResolvedValue({ id: "warden-a" }),
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

  describe("reportCodeRefused (Staff)", () => {
    it("rejects non-assigned staff member", async () => {
      await expect(
        TicketsService.reportCodeRefused("ticket-501", otherStaffUser, "Student refused code")
      ).rejects.toThrow("Only the assigned staff member can raise a code refusal dispute");
    });

    it("requires a non-empty reason", async () => {
      await expect(TicketsService.reportCodeRefused("ticket-501", staffUser, "   ")).rejects.toThrow(
        "Dispute reason is required"
      );
    });

    it("rejects tickets that are not IN_PROGRESS", async () => {
      mockTicket.status = TicketStatus.ASSIGNED;
      await expect(
        TicketsService.reportCodeRefused("ticket-501", staffUser, "Occupant refused code")
      ).rejects.toThrow("Ticket must be in progress to report code refusal");
    });

    it("creates an OPEN Dispute of type CODE_REFUSED and logs DISPUTE_RAISED event", async () => {
      const res = await TicketsService.reportCodeRefused(
        "ticket-501",
        staffUser,
        "Work is complete, occupant refused to provide 4-digit code"
      );

      expect(res.success).toBe(true);
      expect(res.status).toBe(DisputeStatus.OPEN);

      expect(mockDisputes.length).toBe(1);
      expect(mockDisputes[0].type).toBe(DisputeType.CODE_REFUSED);
      expect(mockDisputes[0].status).toBe(DisputeStatus.OPEN);

      const event = mockEvents.find((e) => e.type === EventType.DISPUTE_RAISED);
      expect(event).toBeDefined();
    });
  });

  describe("decideDispute (Warden Decisions)", () => {
    it("rejects warden from deciding dispute in a different block", async () => {
      mockDisputes.push({
        id: "disp-1",
        ticketId: "ticket-501",
        type: DisputeType.CODE_REFUSED,
        status: DisputeStatus.OPEN,
      });

      await expect(
        DisputesService.decideDispute("disp-1", wardenBlockB, { decision: "UPHELD" })
      ).rejects.toThrow("Wardens can only decide disputes in their assigned block");
    });

    it("upholds CODE_REFUSED dispute: closes ticket with WARDEN_DECISION and clears completion code", async () => {
      mockDisputes.push({
        id: "disp-1",
        ticketId: "ticket-501",
        type: DisputeType.CODE_REFUSED,
        status: DisputeStatus.OPEN,
      });

      const res = await DisputesService.decideDispute("disp-1", wardenBlockA, {
        decision: "UPHELD",
        note: "Inspected site, work is satisfactory, code refusal verified",
      });

      expect(res.status).toBe(DisputeStatus.UPHELD);
      expect(mockTicket.status).toBe(TicketStatus.CLOSED);
      expect(mockTicket.closeReason).toBe(CloseReason.WARDEN_DECISION);
      expect(mockTicket.resolutionMethod).toBe(ResolutionMethod.WARDEN);
      expect(mockTicket.completionCode).toBeNull();
      expect(mockTicket.actualWorkMinutes).toBeGreaterThanOrEqual(44);
    });

    it("rejects CODE_REFUSED dispute: leaves ticket IN_PROGRESS for staff to complete", async () => {
      mockDisputes.push({
        id: "disp-2",
        ticketId: "ticket-501",
        type: DisputeType.CODE_REFUSED,
        status: DisputeStatus.OPEN,
      });

      const res = await DisputesService.decideDispute("disp-2", wardenBlockA, {
        decision: "REJECTED",
        note: "Job is incomplete, please finish repairing the latch",
      });

      expect(res.status).toBe(DisputeStatus.REJECTED);
      expect(mockTicket.status).toBe(TicketStatus.IN_PROGRESS);
    });

    it("upholds LOCKED_CLAIM_FALSE dispute: resumes SLA and reassigns with 60-min priority boost", async () => {
      mockTicket.status = TicketStatus.AWAITING_ACCESS;
      mockTicket.pausedAt = new Date(Date.now() - 3600000); // 1 hr ago

      mockDisputes.push({
        id: "disp-3",
        ticketId: "ticket-501",
        type: DisputeType.LOCKED_CLAIM_FALSE,
        status: DisputeStatus.OPEN,
      });

      const res = await DisputesService.decideDispute("disp-3", chiefWarden, {
        decision: "UPHELD",
        note: "Student was in room, staff did not knock",
      });

      expect(res.status).toBe(DisputeStatus.UPHELD);
      expect(mockTicket.status).toBe(TicketStatus.ASSIGNED);
      expect(mockTicket.priorityBoostUntil).not.toBeNull();
      expect(mockTicket.pausedAt).toBeNull();
      expect(mockTicket.totalPausedMinutes).toBeGreaterThanOrEqual(59);
    });
  });
});
