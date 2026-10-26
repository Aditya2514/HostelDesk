import { describe, it, expect } from "vitest";
import { addWorkingMinutes, nextWorkingInstant, ShiftWindow } from "../src/modules/scheduling/shifts";

describe("Shift Calendar & Working-Time Arithmetic (IST)", () => {
  // Standard weekday shifts: 09:00 - 13:00 (540 - 780) & 14:00 - 18:00 (840 - 1080)
  const standardShifts: ShiftWindow[] = [
    // Monday (1)
    { weekday: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
    { weekday: 1, startMinute: 14 * 60, endMinute: 18 * 60 },
    // Tuesday (2)
    { weekday: 2, startMinute: 9 * 60, endMinute: 13 * 60 },
    { weekday: 2, startMinute: 14 * 60, endMinute: 18 * 60 },
    // Wednesday (3)
    { weekday: 3, startMinute: 9 * 60, endMinute: 13 * 60 },
    { weekday: 3, startMinute: 14 * 60, endMinute: 18 * 60 },
    // Thursday (4)
    { weekday: 4, startMinute: 9 * 60, endMinute: 13 * 60 },
    { weekday: 4, startMinute: 14 * 60, endMinute: 18 * 60 },
    // Friday (5)
    { weekday: 5, startMinute: 9 * 60, endMinute: 13 * 60 },
    { weekday: 5, startMinute: 14 * 60, endMinute: 18 * 60 },
  ];

  it("spills into the next day: 60-min job starting Mon 17:30 IST finishes Tue 09:30 IST", () => {
    // Mon 17:30 IST -> 12:00 UTC on 2026-10-26 (Monday)
    const start = new Date("2026-10-26T12:00:00.000Z");
    const finish = addWorkingMinutes(start, 60, standardShifts);

    expect(finish).not.toBeNull();
    // Expected: Tue 09:30 IST -> 04:00 UTC on 2026-10-27 (Tuesday)
    expect(finish?.toISOString()).toBe("2026-10-27T04:00:00.000Z");
  });

  it("spans lunch break: 90-min job starting Mon 12:00 IST finishes Mon 14:30 IST", () => {
    // Mon 12:00 IST -> 06:30 UTC on 2026-10-26
    const start = new Date("2026-10-26T06:30:00.000Z");
    const finish = addWorkingMinutes(start, 90, standardShifts);

    expect(finish).not.toBeNull();
    // 1h worked before 13:00, 30m worked from 14:00 -> finishes 14:30 IST -> 09:00 UTC
    expect(finish?.toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("spans day off: staff off Wednesday, 30-min job starting Tue 17:45 IST finishes Thu 09:15 IST", () => {
    // Shift schedule with Wednesday off
    const shiftsWithWedOff: ShiftWindow[] = standardShifts.filter((s) => s.weekday !== 3);

    // Tue 17:45 IST -> 12:15 UTC on 2026-10-27 (Tuesday)
    const start = new Date("2026-10-27T12:15:00.000Z");
    const finish = addWorkingMinutes(start, 30, shiftsWithWedOff);

    expect(finish).not.toBeNull();
    // 15 min worked on Tue (ends at 18:00), Wednesday is off, 15 min worked on Thu from 09:00 -> Thu 09:15 IST
    // Thu 09:15 IST -> 03:45 UTC on 2026-10-29
    expect(finish?.toISOString()).toBe("2026-10-29T03:45:00.000Z");
  });

  it("returns null when staff has no shifts", () => {
    const start = new Date("2026-10-26T12:00:00.000Z");
    const finish = addWorkingMinutes(start, 60, []);
    expect(finish).toBeNull();

    const next = nextWorkingInstant(start, []);
    expect(next).toBeNull();
  });
});
