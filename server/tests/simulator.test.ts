import { describe, it, expect } from "vitest";
import { simulateQueue, simulateQueueRanges, SimulatorJob } from "../src/modules/scheduling/simulator";
import { ShiftWindow } from "../src/modules/scheduling/shifts";

describe("Queue Simulator (Pure)", () => {
  // Standard weekday shifts 09:00 - 18:00 (540 to 1080)
  const monTueShifts: ShiftWindow[] = [
    { weekday: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
    { weekday: 2, startMinute: 9 * 60, endMinute: 18 * 60 },
  ];

  it("prioritizes URGENT over NORMAL regardless of creation order", () => {
    // Monday 10:00 IST -> 04:30 UTC
    const now = new Date("2026-10-26T04:30:00.000Z");

    const jobs: SimulatorJob[] = [
      {
        ticketId: "normal-early",
        priority: "NORMAL",
        createdAt: new Date("2026-10-26T03:00:00.000Z"),
        durationMinutes: 60,
        status: "ASSIGNED",
      },
      {
        ticketId: "urgent-late",
        priority: "URGENT",
        createdAt: new Date("2026-10-26T04:00:00.000Z"),
        durationMinutes: 45,
        status: "ASSIGNED",
      },
    ];

    const schedule = simulateQueue({ now, shifts: monTueShifts, jobs });

    const urgentSched = schedule.get("urgent-late");
    const normalSched = schedule.get("normal-early");

    expect(urgentSched).toBeDefined();
    expect(normalSched).toBeDefined();

    // Urgent should start at 10:00 IST and finish at 10:45 IST
    expect(urgentSched!.startAt.toISOString()).toBe("2026-10-26T04:30:00.000Z");
    expect(urgentSched!.finishAt.toISOString()).toBe("2026-10-26T05:15:00.000Z");

    // Normal should start after urgent finishes at 10:45 IST
    expect(normalSched!.startAt.toISOString()).toBe("2026-10-26T05:15:00.000Z");
    expect(normalSched!.finishAt.toISOString()).toBe("2026-10-26T06:15:00.000Z");
  });

  it("schedules FIFO within the same priority", () => {
    const now = new Date("2026-10-26T04:30:00.000Z");

    const jobs: SimulatorJob[] = [
      {
        ticketId: "job-second",
        priority: "NORMAL",
        createdAt: new Date("2026-10-26T04:10:00.000Z"),
        durationMinutes: 30,
        status: "ASSIGNED",
      },
      {
        ticketId: "job-first",
        priority: "NORMAL",
        createdAt: new Date("2026-10-26T04:00:00.000Z"),
        durationMinutes: 30,
        status: "ASSIGNED",
      },
    ];

    const schedule = simulateQueue({ now, shifts: monTueShifts, jobs });

    expect(schedule.get("job-first")!.startAt.toISOString()).toBe("2026-10-26T04:30:00.000Z");
    expect(schedule.get("job-second")!.startAt.toISOString()).toBe("2026-10-26T05:00:00.000Z");
  });

  it("handles IN_PROGRESS job first with remaining time accounting", () => {
    // Now is 10:30 IST. Job was started at 10:00 IST (30 mins elapsed).
    // Original duration: 60 mins -> remaining time = max(60 - 30, 5) = 30 mins.
    const now = new Date("2026-10-26T05:00:00.000Z"); // 10:30 IST
    const startedAt = new Date("2026-10-26T04:30:00.000Z"); // 10:00 IST

    const jobs: SimulatorJob[] = [
      {
        ticketId: "urgent-waiting",
        priority: "URGENT",
        createdAt: new Date("2026-10-26T03:00:00.000Z"),
        durationMinutes: 40,
        status: "ASSIGNED",
      },
      {
        ticketId: "in-progress-job",
        priority: "NORMAL",
        createdAt: new Date("2026-10-26T02:00:00.000Z"),
        durationMinutes: 60,
        status: "IN_PROGRESS",
        startedAt,
      },
    ];

    const schedule = simulateQueue({ now, shifts: monTueShifts, jobs });

    // Even though urgent-waiting is URGENT, IN_PROGRESS goes first
    const inProgSched = schedule.get("in-progress-job");
    const urgentSched = schedule.get("urgent-waiting");

    expect(inProgSched!.startAt.toISOString()).toBe("2026-10-26T05:00:00.000Z"); // 10:30 IST
    expect(inProgSched!.finishAt.toISOString()).toBe("2026-10-26T05:30:00.000Z"); // 11:00 IST (needs 30m)

    expect(urgentSched!.startAt.toISOString()).toBe("2026-10-26T05:30:00.000Z"); // starts after in-progress
  });

  it("handles multiple IN_PROGRESS jobs, scheduling all first, oldest startedAt first", () => {
    // Now is 10:30 IST. Two jobs in progress:
    // Job 1: started at 09:30 IST (1h worked), duration 90m -> remaining 30m
    // Job 2: started at 10:00 IST (30m worked), duration 45m -> remaining 15m
    const now = new Date("2026-10-26T05:00:00.000Z"); // 10:30 IST
    const startedAt1 = new Date("2026-10-26T04:00:00.000Z"); // 09:30 IST
    const startedAt2 = new Date("2026-10-26T04:30:00.000Z"); // 10:00 IST

    const jobs: SimulatorJob[] = [
      {
        ticketId: "urgent-waiting",
        priority: "URGENT",
        createdAt: new Date("2026-10-26T01:00:00.000Z"),
        durationMinutes: 20,
        status: "ASSIGNED",
      },
      {
        ticketId: "in-prog-2",
        priority: "LOW",
        createdAt: new Date("2026-10-26T03:00:00.000Z"),
        durationMinutes: 45,
        status: "IN_PROGRESS",
        startedAt: startedAt2,
      },
      {
        ticketId: "in-prog-1",
        priority: "NORMAL",
        createdAt: new Date("2026-10-26T02:00:00.000Z"),
        durationMinutes: 90,
        status: "IN_PROGRESS",
        startedAt: startedAt1,
      },
    ];

    const schedule = simulateQueue({ now, shifts: monTueShifts, jobs });

    const sched1 = schedule.get("in-prog-1")!;
    const sched2 = schedule.get("in-prog-2")!;
    const schedUrgent = schedule.get("urgent-waiting")!;

    // in-prog-1 (oldest startedAt) starts at now (10:30 IST), takes 30m -> finishes 11:00 IST
    expect(sched1.startAt.toISOString()).toBe("2026-10-26T05:00:00.000Z");
    expect(sched1.finishAt.toISOString()).toBe("2026-10-26T05:30:00.000Z");

    // in-prog-2 starts at 11:00 IST, takes 15m -> finishes 11:15 IST
    expect(sched2.startAt.toISOString()).toBe("2026-10-26T05:30:00.000Z");
    expect(sched2.finishAt.toISOString()).toBe("2026-10-26T05:45:00.000Z");

    // urgent-waiting starts at 11:15 IST (after all in-progress jobs)
    expect(schedUrgent.startAt.toISOString()).toBe("2026-10-26T05:45:00.000Z");
  });

  it("computes in-progress elapsed time strictly from working shift minutes, excluding overnight hours", () => {
    // Job started Mon 17:50 IST (10m before Mon 18:00 end of shift).
    // Now is Tue 09:10 IST (10m into Tue 09:00 shift).
    // Total working minutes worked: 10 + 10 = 20 mins (overnight hours completely excluded!).
    // Original duration: 50 mins -> remaining = 50 - 20 = 30 mins.
    const startedAt = new Date("2026-10-26T12:20:00.000Z"); // Mon 17:50 IST
    const now = new Date("2026-10-27T03:40:00.000Z");       // Tue 09:10 IST

    const jobs: SimulatorJob[] = [
      {
        ticketId: "overnight-in-prog",
        priority: "NORMAL",
        createdAt: new Date("2026-10-26T10:00:00.000Z"),
        durationMinutes: 50,
        status: "IN_PROGRESS",
        startedAt,
      },
    ];

    const schedule = simulateQueue({ now, shifts: monTueShifts, jobs });
    const sched = schedule.get("overnight-in-prog")!;

    // Starts at now (Tue 09:10 IST), needs 30 mins -> finishes Tue 09:40 IST (04:10 UTC)
    expect(sched.startAt.toISOString()).toBe("2026-10-27T03:40:00.000Z");
    expect(sched.finishAt.toISOString()).toBe("2026-10-27T04:10:00.000Z");
  });

  it("ignores ON_HOLD and AWAITING_ACCESS jobs", () => {
    const now = new Date("2026-10-26T04:30:00.000Z");

    const jobs: SimulatorJob[] = [
      {
        ticketId: "held-job",
        priority: "URGENT",
        createdAt: new Date("2026-10-26T02:00:00.000Z"),
        durationMinutes: 50,
        status: "ON_HOLD",
      },
      {
        ticketId: "awaiting-job",
        priority: "URGENT",
        createdAt: new Date("2026-10-26T02:30:00.000Z"),
        durationMinutes: 50,
        status: "AWAITING_ACCESS",
      },
      {
        ticketId: "active-job",
        priority: "NORMAL",
        createdAt: new Date("2026-10-26T04:00:00.000Z"),
        durationMinutes: 45,
        status: "ASSIGNED",
      },
    ];

    const schedule = simulateQueue({ now, shifts: monTueShifts, jobs });

    expect(schedule.has("held-job")).toBe(false);
    expect(schedule.has("awaiting-job")).toBe(false);
    expect(schedule.has("active-job")).toBe(true);
    expect(schedule.get("active-job")!.startAt.toISOString()).toBe("2026-10-26T04:30:00.000Z");
  });

  it("respects notBefore with other jobs filling the gap", () => {
    // 10:00 IST -> 04:30 UTC
    const now = new Date("2026-10-26T04:30:00.000Z");

    // slotJob has higher priority but student requested slot at 12:00 IST (06:30 UTC)
    const slotJob: SimulatorJob = {
      ticketId: "slot-job",
      priority: "URGENT",
      createdAt: new Date("2026-10-26T02:00:00.000Z"),
      durationMinutes: 30,
      status: "ASSIGNED",
      notBefore: new Date("2026-10-26T06:30:00.000Z"), // 12:00 IST
    };

    const fillerJob: SimulatorJob = {
      ticketId: "filler-job",
      priority: "NORMAL",
      createdAt: new Date("2026-10-26T03:00:00.000Z"),
      durationMinutes: 60,
      status: "ASSIGNED",
    };

    const schedule = simulateQueue({ now, shifts: monTueShifts, jobs: [slotJob, fillerJob] });

    // Filler job runs first at 10:00 IST since slotJob cannot start before 12:00 IST
    expect(schedule.get("filler-job")!.startAt.toISOString()).toBe("2026-10-26T04:30:00.000Z");
    expect(schedule.get("filler-job")!.finishAt.toISOString()).toBe("2026-10-26T05:30:00.000Z"); // 11:00 IST

    // Cursor advances to 12:00 IST for slotJob
    expect(schedule.get("slot-job")!.startAt.toISOString()).toBe("2026-10-26T06:30:00.000Z"); // 12:00 IST
    expect(schedule.get("slot-job")!.finishAt.toISOString()).toBe("2026-10-26T07:00:00.000Z"); // 12:30 IST
  });

  // =========================================================================
  // WORKED EXAMPLE TEST CASE (Mandatory from prompt)
  // =========================================================================
  describe("Worked Example (Ramesh, Suresh, Anil)", () => {
    // Monday 16:30 IST -> 11:00 UTC on 2026-10-26
    const now = new Date("2026-10-26T11:00:00.000Z");

    const newTapJob: SimulatorJob = {
      ticketId: "new-tap-job",
      priority: "NORMAL",
      createdAt: new Date("2026-10-26T11:00:00.000Z"), // 16:30 IST
      durationMinutes: 60,
      status: "ASSIGNED",
    };

    it("simulates Ramesh finishing on Tuesday at ~10:05 IST", () => {
      // Ramesh shift: Mon 09:00 - 18:00, Tue 09:00 - 18:00
      const rameshShifts: ShiftWindow[] = [
        { weekday: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
        { weekday: 2, startMinute: 9 * 60, endMinute: 18 * 60 },
      ];

      const rameshJobs: SimulatorJob[] = [
        {
          ticketId: "ramesh-urgent",
          priority: "URGENT",
          createdAt: new Date("2026-10-26T09:30:00.000Z"), // 15:00 IST
          durationMinutes: 45,
          status: "ASSIGNED",
        },
        {
          ticketId: "ramesh-older-normal",
          priority: "NORMAL",
          createdAt: new Date("2026-10-26T08:30:00.000Z"), // 14:00 IST (older than newTapJob)
          durationMinutes: 50,
          status: "ASSIGNED",
        },
        newTapJob,
      ];

      const schedule = simulateQueue({ now, shifts: rameshShifts, jobs: rameshJobs });
      const finish = schedule.get("new-tap-job")!.finishAt;

      // Tue 10:05 IST = 04:35 UTC on 2026-10-27
      expect(finish.toISOString()).toBe("2026-10-27T04:35:00.000Z");
    });

    it("simulates Suresh finishing on Tuesday at 10:00 IST", () => {
      // Suresh: off Monday, starts Tue 09:00 - 18:00
      const sureshShifts: ShiftWindow[] = [
        { weekday: 2, startMinute: 9 * 60, endMinute: 18 * 60 },
      ];

      const sureshJobs: SimulatorJob[] = [newTapJob];

      const schedule = simulateQueue({ now, shifts: sureshShifts, jobs: sureshJobs });
      const finish = schedule.get("new-tap-job")!.finishAt;

      // Tue 10:00 IST = 04:30 UTC on 2026-10-27
      expect(finish.toISOString()).toBe("2026-10-27T04:30:00.000Z");
    });

    it("simulates Anil finishing on Monday at 17:30 IST and winning routing", () => {
      // Anil: shift Mon until 18:00, Tue 09:00 - 18:00, empty queue
      const anilShifts: ShiftWindow[] = [
        { weekday: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
        { weekday: 2, startMinute: 9 * 60, endMinute: 18 * 60 },
      ];

      const anilJobs: SimulatorJob[] = [newTapJob];

      const schedule = simulateQueue({ now, shifts: anilShifts, jobs: anilJobs });
      const finish = schedule.get("new-tap-job")!.finishAt;

      // Mon 17:30 IST = 12:00 UTC on 2026-10-26
      expect(finish.toISOString()).toBe("2026-10-26T12:00:00.000Z");
    });

    it("proves Anil is chosen because his finish time is earliest", () => {
      // Compare finishes: Anil (Mon 17:30) < Suresh (Tue 10:00) < Ramesh (Tue 10:05)
      const rameshFinish = new Date("2026-10-27T04:35:00.000Z");
      const sureshFinish = new Date("2026-10-27T04:30:00.000Z");
      const anilFinish = new Date("2026-10-26T12:00:00.000Z");

      const candidates = [
        { name: "Ramesh", finish: rameshFinish },
        { name: "Suresh", finish: sureshFinish },
        { name: "Anil", finish: anilFinish },
      ];

      candidates.sort((a, b) => a.finish.getTime() - b.finish.getTime());

      expect(candidates[0].name).toBe("Anil");
    });
  });
});
