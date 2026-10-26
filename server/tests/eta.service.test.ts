import { describe, it, expect, vi, beforeEach } from "vitest";
import { EtaService, formatIstTime, studentDelayReason } from "../src/modules/scheduling/eta.service";
import { prisma } from "../src/lib/prisma";
import { clock } from "../src/lib/clock";
import { TicketStatus, Priority } from "@prisma/client";
import * as estimatorModule from "../src/modules/scheduling/estimator";
import { NotificationService } from "../src/modules/notifications/notification.service";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    ticket: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    ticketPrediction: {
      create: vi.fn(),
    },
    notification: {
      createMany: vi.fn(),
    },
  },
}));

vi.mock("../src/modules/notifications/notification.service", () => ({
  NotificationService: {
    getTicketAudience: vi.fn().mockResolvedValue(["student-1", "student-2"]),
    notify: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("EtaService & Recompute Queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Monday 10:00 IST -> 04:30 UTC
    vi.spyOn(clock, "now").mockReturnValue(new Date("2026-10-26T04:30:00.000Z"));
  });

  it("formats IST time strings correctly relative to now", () => {
    const now = new Date("2026-10-26T04:30:00.000Z"); // Mon 10:00 IST
    const sameDay = new Date("2026-10-26T12:00:00.000Z"); // Mon 17:30 IST
    const tomorrow = new Date("2026-10-27T04:30:00.000Z"); // Tue 10:00 IST

    expect(formatIstTime(sameDay, now)).toBe("5:30 PM");
    expect(formatIstTime(tomorrow, now)).toBe("Tomorrow 10:00 AM");
  });

  it("clears ETA for ON_HOLD and AWAITING_ACCESS tickets", async () => {
    const mockStaff = {
      id: "staff-1",
      shifts: [{ weekday: 1, startMinute: 540, endMinute: 1080 }],
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockStaff as any);

    const onHoldTicket = {
      id: "ticket-hold",
      status: TicketStatus.ON_HOLD,
      etaP50At: new Date("2026-10-26T08:00:00.000Z"),
      etaP80At: new Date("2026-10-26T09:00:00.000Z"),
      category: { id: "cat-1", name: "Fan Repair", defaultDurationMin: 40 },
    };

    vi.mocked(prisma.ticket.findMany).mockResolvedValue([onHoldTicket] as any);

    await EtaService.recomputeStaffQueue("staff-1", "TICK");

    // The notified baseline is cleared too, so resuming doesn't trigger a "delayed" message
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "ticket-hold" },
      data: { etaP50At: null, etaP80At: null, etaNotifiedP50At: null },
    });
  });

  it("sends delay notification when new p50 is > 30 minutes later than etaNotifiedP50At", async () => {
    const mockStaff = {
      id: "staff-1",
      shifts: [{ weekday: 1, startMinute: 540, endMinute: 1080 }],
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockStaff as any);

    vi.spyOn(estimatorModule, "getDurationEstimate").mockResolvedValue({
      p50Minutes: 60,
      p80Minutes: 90,
      n: 10,
      observedMedian: 60,
      observedP80: 90,
      scope: "BLOCK",
      defaultDuration: 60,
    });

    // Previous notified ETA was 10:30 IST (05:00 UTC)
    // New simulation will finish at 11:00 IST (05:30 UTC), wait: 10:00 IST + 60 min = 11:00 IST.
    // Delay = 11:00 IST - 10:15 IST = 45 min (> 30 min)
    const activeTicket = {
      id: "ticket-delayed",
      status: TicketStatus.ASSIGNED,
      priority: Priority.NORMAL,
      createdAt: new Date("2026-10-26T03:00:00.000Z"),
      categoryId: "cat-1",
      blockId: "block-a",
      etaP50At: new Date("2026-10-26T04:45:00.000Z"), // 10:15 IST
      etaNotifiedP50At: new Date("2026-10-26T04:45:00.000Z"), // 10:15 IST
      category: { id: "cat-1", name: "Fan Repair", defaultDurationMin: 60 },
    };

    vi.mocked(prisma.ticket.findMany).mockResolvedValue([activeTicket] as any);

    await EtaService.recomputeStaffQueue("staff-1", "NEW_TICKET", undefined, "some-other-ticket");

    // Notification should be sent to audience
    expect(NotificationService.notify).toHaveBeenCalledTimes(1);
    const notifyCall = vi.mocked(NotificationService.notify).mock.calls[0];
    expect(notifyCall[1].type).toBe("ETA_DELAYED");
    expect(notifyCall[1].message).toContain("Fan Repair fix is delayed");
    expect(notifyCall[1].message).toContain("a more urgent issue was added ahead of yours");

    // Prediction row should also be recorded (change > 5 min)
    expect(prisma.ticketPrediction.create).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: does not send notifications or insert prediction rows when p50 did not change", async () => {
    const mockStaff = {
      id: "staff-1",
      shifts: [{ weekday: 1, startMinute: 540, endMinute: 1080 }],
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockStaff as any);

    vi.spyOn(estimatorModule, "getDurationEstimate").mockResolvedValue({
      p50Minutes: 60,
      p80Minutes: 90,
      n: 10,
      observedMedian: 60,
      observedP80: 90,
      scope: "BLOCK",
      defaultDuration: 60,
    });

    // ETA is already 11:00 IST (05:30 UTC), which matches the simulation exactly
    const ticketUnchanged = {
      id: "ticket-same",
      status: TicketStatus.ASSIGNED,
      priority: Priority.NORMAL,
      createdAt: new Date("2026-10-26T03:00:00.000Z"),
      categoryId: "cat-1",
      blockId: "block-a",
      etaP50At: new Date("2026-10-26T05:30:00.000Z"), // exactly 11:00 IST
      etaP80At: new Date("2026-10-26T06:00:00.000Z"), // exactly 11:30 IST
      etaNotifiedP50At: new Date("2026-10-26T05:30:00.000Z"),
      category: { id: "cat-1", name: "Fan Repair", defaultDurationMin: 60 },
    };

    vi.mocked(prisma.ticket.findMany).mockResolvedValue([ticketUnchanged] as any);

    await EtaService.recomputeStaffQueue("staff-1", "TICK");

    // No prediction spam
    expect(prisma.ticketPrediction.create).not.toHaveBeenCalled();
    // No notification spam
    expect(NotificationService.notify).not.toHaveBeenCalled();
    // No ticket update needed
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it("saves the notified baseline even when the stored ETA moved by 5 minutes or less (no repeated delay messages)", async () => {
    // Regression: the ETA drifted in small steps, so etaP50At (10:57 IST) is already close to the
    // new ETA (11:00 IST), but the last ETA the student was told about is 10:15 IST.
    // A delay message must be sent once AND the baseline saved; otherwise every tick re-sends it.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "staff-1",
      shifts: [{ weekday: 1, startMinute: 540, endMinute: 1080 }],
    } as any);
    vi.spyOn(estimatorModule, "getDurationEstimate").mockResolvedValue({
      p50Minutes: 60, p80Minutes: 90, n: 10, observedMedian: 60, observedP80: 90, scope: "BLOCK", defaultDuration: 60,
    });

    const driftedTicket = {
      id: "ticket-drifted",
      status: TicketStatus.ASSIGNED,
      priority: Priority.NORMAL,
      createdAt: new Date("2026-10-26T03:00:00.000Z"),
      categoryId: "cat-1",
      blockId: "block-a",
      etaP50At: new Date("2026-10-26T05:27:00.000Z"), // 10:57 IST (3 min from new ETA)
      etaP80At: new Date("2026-10-26T05:57:00.000Z"),
      etaNotifiedP50At: new Date("2026-10-26T04:45:00.000Z"), // 10:15 IST
      category: { id: "cat-1", name: "Fan Repair", defaultDurationMin: 60 },
    };
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([driftedTicket] as any);

    await EtaService.recomputeStaffQueue("staff-1", "TICK");

    expect(NotificationService.notify).toHaveBeenCalledTimes(1);
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "ticket-drifted" },
      data: { etaNotifiedP50At: new Date("2026-10-26T05:30:00.000Z") },
    });
    expect(prisma.ticketPrediction.create).not.toHaveBeenCalled();
  });

  it("chooses student-facing delay reasons from reason codes, not keywords", () => {
    expect(studentDelayReason("PRIORITY_CHANGED", false)).toBe("a more urgent issue was moved ahead of yours");
    expect(studentDelayReason("PRIORITY_CHANGED", true)).toBe("the warden changed your ticket's priority");
    expect(studentDelayReason("NEW_TICKET", false)).toBe("a more urgent issue was added ahead of yours");
    expect(studentDelayReason("REASSIGNED_IN", true)).toBe("your ticket was moved to a different staff member's queue");
    expect(studentDelayReason("TICK", false)).toBe("the staff member's current job is taking longer than expected");
    expect(studentDelayReason("REJECTED", false)).toBe("the staff member's schedule changed");
  });
});
