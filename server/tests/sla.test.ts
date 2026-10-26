import { describe, it, expect } from "vitest";
import { pauseSla, resumeSla, SlaTicketLike } from "../src/modules/tickets/sla";

describe("SLA Pause & Resume Accounting (modules/tickets/sla.ts)", () => {
  it("sets pausedAt = now when pausing an active ticket", () => {
    const t0 = new Date("2026-10-26T10:00:00.000Z");
    const dueAt = new Date("2026-10-28T10:00:00.000Z"); // 48h SLA

    const ticket: SlaTicketLike = {
      dueAt,
      pausedAt: null,
      totalPausedMinutes: 0,
    };

    const res = pauseSla(ticket, t0);
    expect(res).not.toBeNull();
    expect(res?.pausedAt).toEqual(t0);
    expect(ticket.pausedAt).toEqual(t0);
    expect(ticket.totalPausedMinutes).toBe(0);
    expect(ticket.dueAt).toEqual(dueAt);
  });

  it("does not overwrite pausedAt if ticket is already paused", () => {
    const t0 = new Date("2026-10-26T10:00:00.000Z");
    const t1 = new Date("2026-10-26T11:00:00.000Z");
    const dueAt = new Date("2026-10-28T10:00:00.000Z");

    const ticket: SlaTicketLike = {
      dueAt,
      pausedAt: t0,
      totalPausedMinutes: 0,
    };

    const res = pauseSla(ticket, t1);
    expect(res).toBeNull();
    expect(ticket.pausedAt).toEqual(t0);
  });

  it("returns null when resuming a ticket that was not paused", () => {
    const now = new Date("2026-10-26T12:00:00.000Z");
    const ticket: SlaTicketLike = {
      dueAt: new Date("2026-10-28T10:00:00.000Z"),
      pausedAt: null,
      totalPausedMinutes: 0,
    };

    const res = resumeSla(ticket, now);
    expect(res).toBeNull();
  });

  it("pauses 3 hours -> dueAt moves exactly 3 hours later and totalPausedMinutes = 180", () => {
    const startPaused = new Date("2026-10-26T10:00:00.000Z");
    const endPaused = new Date("2026-10-26T13:00:00.000Z"); // Exactly 3 hours later
    const initialDueAt = new Date("2026-10-27T10:00:00.000Z"); // 24h SLA

    const ticket: SlaTicketLike = {
      dueAt: initialDueAt,
      pausedAt: startPaused,
      totalPausedMinutes: 0,
    };

    const res = resumeSla(ticket, endPaused);
    expect(res).not.toBeNull();
    expect(res?.pausedMinutesAdded).toBe(180);
    expect(res?.totalPausedMinutes).toBe(180);
    expect(res?.pausedAt).toBeNull();

    // dueAt should move 3 hours later: 10:00 -> 13:00
    const expectedDueAt = new Date("2026-10-27T13:00:00.000Z");
    expect(res?.dueAt).toEqual(expectedDueAt);
    expect(ticket.dueAt).toEqual(expectedDueAt);
    expect(ticket.totalPausedMinutes).toBe(180);
    expect(ticket.pausedAt).toBeNull();
  });

  it("two consecutive pause intervals add up accurately", () => {
    const t0 = new Date("2026-10-26T09:00:00.000Z");
    const initialDueAt = new Date("2026-10-27T09:00:00.000Z");

    const ticket: SlaTicketLike = {
      dueAt: initialDueAt,
      pausedAt: null,
      totalPausedMinutes: 0,
    };

    // Pause 1: 10:00 to 13:00 (3 hours = 180 min)
    const p1Start = new Date("2026-10-26T10:00:00.000Z");
    pauseSla(ticket, p1Start);
    const p1End = new Date("2026-10-26T13:00:00.000Z");
    resumeSla(ticket, p1End);

    expect(ticket.totalPausedMinutes).toBe(180);
    expect(ticket.dueAt).toEqual(new Date("2026-10-27T12:00:00.000Z")); // +3h

    // Pause 2: 15:00 to 17:30 (2.5 hours = 150 min)
    const p2Start = new Date("2026-10-26T15:00:00.000Z");
    pauseSla(ticket, p2Start);
    const p2End = new Date("2026-10-26T17:30:00.000Z");
    resumeSla(ticket, p2End);

    expect(ticket.totalPausedMinutes).toBe(330); // 180 + 150
    expect(ticket.dueAt).toEqual(new Date("2026-10-27T14:30:00.000Z")); // +5.5h total
    expect(ticket.pausedAt).toBeNull();
  });
});
