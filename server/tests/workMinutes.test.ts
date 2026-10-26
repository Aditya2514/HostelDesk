import { describe, it, expect } from "vitest";
import { TicketStatus } from "@prisma/client";
import { calculateActualWorkMinutes } from "../src/modules/tickets/workMinutes";

describe("actualWorkMinutes Calculation (Task 5)", () => {
  it("computes single continuous IN_PROGRESS interval", () => {
    const events = [
      {
        toStatus: TicketStatus.IN_PROGRESS,
        createdAt: new Date("2026-10-26T10:00:00.000Z"),
      },
    ];
    const resolvedAt = new Date("2026-10-26T10:45:00.000Z");

    const minutes = calculateActualWorkMinutes(events, resolvedAt);
    expect(minutes).toBe(45);
  });

  it("excludes ON_HOLD interval in the middle of work", () => {
    // 09:00 - 09:40: worked 40 min
    // 09:40 - 11:10: ON_HOLD (90 min on hold waiting for part)
    // 11:10 - 11:45: worked 35 min
    // Total actual work: 40 + 35 = 75 min
    const events = [
      {
        toStatus: TicketStatus.ASSIGNED,
        createdAt: new Date("2026-10-26T08:30:00.000Z"),
      },
      {
        fromStatus: TicketStatus.ASSIGNED,
        toStatus: TicketStatus.IN_PROGRESS,
        createdAt: new Date("2026-10-26T09:00:00.000Z"),
      },
      {
        fromStatus: TicketStatus.IN_PROGRESS,
        toStatus: TicketStatus.ON_HOLD,
        createdAt: new Date("2026-10-26T09:40:00.000Z"),
      },
      {
        fromStatus: TicketStatus.ON_HOLD,
        toStatus: TicketStatus.IN_PROGRESS,
        createdAt: new Date("2026-10-26T11:10:00.000Z"),
      },
    ];
    const resolvedAt = new Date("2026-10-26T11:45:00.000Z");

    const minutes = calculateActualWorkMinutes(events, resolvedAt);
    expect(minutes).toBe(75);
  });

  it("excludes AWAITING_ACCESS interval in the middle of work", () => {
    // 14:00 - 14:15: worked 15 min
    // 14:15 - 16:00: AWAITING_ACCESS (room locked for 105 min)
    // 16:00 - 16:20: worked 20 min
    // Total actual work: 15 + 20 = 35 min
    const events = [
      {
        toStatus: TicketStatus.IN_PROGRESS,
        createdAt: new Date("2026-10-26T14:00:00.000Z"),
      },
      {
        fromStatus: TicketStatus.IN_PROGRESS,
        toStatus: TicketStatus.AWAITING_ACCESS,
        createdAt: new Date("2026-10-26T14:15:00.000Z"),
      },
      {
        fromStatus: TicketStatus.AWAITING_ACCESS,
        toStatus: TicketStatus.IN_PROGRESS,
        createdAt: new Date("2026-10-26T16:00:00.000Z"),
      },
    ];
    const resolvedAt = new Date("2026-10-26T16:20:00.000Z");

    const minutes = calculateActualWorkMinutes(events, resolvedAt);
    expect(minutes).toBe(35);
  });

  it("handles complex lifecycle with both ON_HOLD and AWAITING_ACCESS", () => {
    // 1. Work: 30 min (10:00 - 10:30)
    // 2. Hold: 2 hours (10:30 - 12:30)
    // 3. Work: 20 min (12:30 - 12:50)
    // 4. Locked: 1 hour (12:50 - 13:50)
    // 5. Work: 10 min (13:50 - 14:00)
    // Total: 30 + 20 + 10 = 60 min
    const events = [
      {
        toStatus: TicketStatus.IN_PROGRESS,
        createdAt: new Date("2026-10-26T10:00:00.000Z"),
      },
      {
        fromStatus: TicketStatus.IN_PROGRESS,
        toStatus: TicketStatus.ON_HOLD,
        createdAt: new Date("2026-10-26T10:30:00.000Z"),
      },
      {
        fromStatus: TicketStatus.ON_HOLD,
        toStatus: TicketStatus.IN_PROGRESS,
        createdAt: new Date("2026-10-26T12:30:00.000Z"),
      },
      {
        fromStatus: TicketStatus.IN_PROGRESS,
        toStatus: TicketStatus.AWAITING_ACCESS,
        createdAt: new Date("2026-10-26T12:50:00.000Z"),
      },
      {
        fromStatus: TicketStatus.AWAITING_ACCESS,
        toStatus: TicketStatus.IN_PROGRESS,
        createdAt: new Date("2026-10-26T13:50:00.000Z"),
      },
    ];
    const resolvedAt = new Date("2026-10-26T14:00:00.000Z");

    const minutes = calculateActualWorkMinutes(events, resolvedAt);
    expect(minutes).toBe(60);
  });
});
