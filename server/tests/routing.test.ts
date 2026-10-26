import { describe, it, expect, vi, beforeEach } from "vitest";
import { RoutingService } from "../src/modules/scheduling/routing.service";
import { prisma } from "../src/lib/prisma";
import { clock } from "../src/lib/clock";
import { Trade, Role, Priority, TicketStatus } from "@prisma/client";
import * as estimatorModule from "../src/modules/scheduling/estimator";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    category: {
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    ticket: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

describe("Routing Service (Earliest Simulated Finish)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Monday 09:00 IST -> 03:30 UTC
    vi.spyOn(clock, "now").mockReturnValue(new Date("2026-10-26T03:30:00.000Z"));
  });

  it("selects the earliest finisher even if they are more loaded than an idle staff member", async () => {
    // Both are plumbers
    const mockCategory = {
      id: "cat-plumb",
      name: "Tap Leak",
      trade: Trade.PLUMBER,
      defaultDurationMin: 40,
    };

    vi.mocked(prisma.category.findUnique).mockResolvedValue(mockCategory as any);

    // Mock duration estimator: returns 40 min p50, 60 min p80
    vi.spyOn(estimatorModule, "getDurationEstimate").mockResolvedValue({
      p50Minutes: 40,
      p80Minutes: 60,
      n: 10,
      observedMedian: 40,
      observedP80: 60,
      scope: "BLOCK",
      defaultDuration: 40,
    });

    // Staff A is on duty today (Monday 09:00 - 18:00), has 1 open job (30 min)
    // Staff B has 0 open jobs, but is OFF Monday and only works Tuesday 09:00 - 18:00
    const staffA = {
      id: "staff-busy-today",
      name: "Ramesh (Busy Today)",
      role: Role.STAFF,
      trade: Trade.PLUMBER,
      isActive: true,
      shifts: [
        { weekday: 1, startMinute: 9 * 60, endMinute: 18 * 60 }, // Monday
      ],
    };

    const staffB = {
      id: "staff-idle-tomorrow",
      name: "Suresh (Idle Tomorrow)",
      role: Role.STAFF,
      trade: Trade.PLUMBER,
      isActive: true,
      shifts: [
        { weekday: 2, startMinute: 9 * 60, endMinute: 18 * 60 }, // Tuesday only
      ],
    };

    vi.mocked(prisma.user.findMany).mockResolvedValue([staffA, staffB] as any);

    // Mock open tickets in queue
    vi.mocked(prisma.ticket.findMany).mockImplementation(async (args: any) => {
      if (args.where.assignedToId === staffA.id) {
        // Staff A has 1 open ticket
        return [
          {
            id: "existing-ticket-1",
            categoryId: "cat-plumb",
            blockId: "block-a",
            priority: Priority.NORMAL,
            createdAt: new Date("2026-10-26T03:00:00.000Z"),
            status: TicketStatus.ASSIGNED,
            startedAt: null,
            preferredSlotStart: null,
          },
        ] as any;
      }
      if (args.where.assignedToId === staffB.id) {
        // Staff B has 0 open tickets
        return [] as any;
      }
      return [] as any;
    });

    const result = await RoutingService.chooseAssignee(
      {
        categoryId: mockCategory.id,
        trade: Trade.PLUMBER,
        priority: Priority.NORMAL,
        createdAt: new Date("2026-10-26T03:30:00.000Z"),
      },
      prisma as any
    );

    expect(result).not.toBeNull();
    // Staff A must win because finish is TODAY (~10:10 IST), whereas Staff B would finish TOMORROW (~09:40 IST)
    expect(result!.staffId).toBe(staffA.id);
    expect(result!.explanation.jobsAheadCount).toBe(1);
    expect(result!.etaP50At.getTime()).toBeLessThan(new Date("2026-10-27T00:00:00.000Z").getTime());
  });

  it("returns null if no eligible staff can complete within 14 days", async () => {
    vi.mocked(prisma.category.findUnique).mockResolvedValue({
      id: "cat-plumb",
      trade: Trade.PLUMBER,
    } as any);

    // Staff has empty shifts
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "staff-no-shifts",
        name: "No Shifts Staff",
        role: Role.STAFF,
        trade: Trade.PLUMBER,
        isActive: true,
        shifts: [],
      },
    ] as any);

    const result = await RoutingService.chooseAssignee(
      {
        categoryId: "cat-plumb",
        trade: Trade.PLUMBER,
      },
      prisma as any
    );

    expect(result).toBeNull();
  });
});
