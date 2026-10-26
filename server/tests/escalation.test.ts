import { describe, it, expect, vi, beforeEach } from "vitest";
import { TicketStatus, Role, EventType } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { clock } from "../src/lib/clock";
import { NotificationService } from "../src/modules/notifications/notification.service";
import { EscalationJob } from "../src/jobs/escalation.job";

describe("EscalationJob (Phase 5 - SLA Breach Levels 1 and 2)", () => {
  const fixedNow = new Date("2026-10-27T10:00:00.000Z");

  let ticketsStore: any[] = [];
  let eventsStore: any[] = [];
  let notificationsStore: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(clock, "now").mockReturnValue(new Date(fixedNow));

    ticketsStore = [];
    eventsStore = [];
    notificationsStore = [];

    // Mock prisma.ticket.findMany
    vi.spyOn(prisma.ticket, "findMany").mockImplementation(async ({ where }: any) => {
      return ticketsStore.filter((t) => {
        if (where?.status?.in && !where.status.in.includes(t.status)) return false;
        if (where?.escalationLevel !== undefined && t.escalationLevel !== where.escalationLevel) return false;
        if (where?.pausedAt === null && t.pausedAt !== null) return false;
        if (where?.dueAt?.lt && !(t.dueAt < where.dueAt.lt)) return false;
        if (where?.escalatedAt?.lte && !(t.escalatedAt && t.escalatedAt <= where.escalatedAt.lte)) return false;
        if (where?.blockId && t.blockId !== where.blockId) return false;
        return true;
      });
    });

    // Mock prisma.ticket.updateMany
    vi.spyOn(prisma.ticket, "updateMany").mockImplementation(async ({ where, data }: any) => {
      const match = ticketsStore.find((t) => {
        if (t.id !== where.id) return false;
        if (where.escalationLevel !== undefined && t.escalationLevel !== where.escalationLevel) return false;
        return true;
      });

      if (match) {
        Object.assign(match, data);
        return { count: 1 };
      }
      return { count: 0 };
    });

    // Mock prisma.ticketEvent.create
    vi.spyOn(prisma.ticketEvent, "create").mockImplementation(async ({ data }: any) => {
      const event = { id: `event-${eventsStore.length + 1}`, ...data };
      eventsStore.push(event);
      return event;
    });

    // Mock prisma.user.findMany
    vi.spyOn(prisma.user, "findMany").mockImplementation(async ({ where }: any) => {
      if (where.role === Role.WARDEN) {
        return [{ id: `warden-${where.blockId || "any"}` }];
      }
      if (where.role === Role.CHIEF_WARDEN) {
        return [{ id: "chief-warden-1" }];
      }
      if (where.role === Role.ADMIN) {
        return [{ id: "admin-1" }];
      }
      return [];
    });

    // Mock NotificationService.notify
    vi.spyOn(NotificationService, "notify").mockImplementation(async (userIds, payload) => {
      notificationsStore.push({ userIds, payload });
    });
  });

  it("escalates Level 0 ticket to Level 1 when dueAt has passed and SLA is active", async () => {
    // Ticket due 1 hour ago
    ticketsStore.push({
      id: "ticket-101",
      code: "HD-0101",
      title: "Water leaking heavily",
      blockId: "block-a",
      status: TicketStatus.ASSIGNED,
      escalationLevel: 0,
      escalatedAt: null,
      pausedAt: null,
      dueAt: new Date(fixedNow.getTime() - 60 * 60 * 1000), // 1 hour overdue
    });

    const result = await EscalationJob.run();

    expect(result.level1EscalatedCount).toBe(1);
    expect(result.level2EscalatedCount).toBe(0);

    // Verify DB update
    expect(ticketsStore[0].escalationLevel).toBe(1);
    expect(ticketsStore[0].escalatedAt).toEqual(fixedNow);

    // Verify TicketEvent
    expect(eventsStore).toHaveLength(1);
    expect(eventsStore[0].type).toBe(EventType.ESCALATED);
    expect(eventsStore[0].note).toContain("Level 1 (Block Warden)");

    // Verify Block Warden Notification
    expect(notificationsStore).toHaveLength(1);
    expect(notificationsStore[0].userIds).toEqual(["warden-block-a"]);
    expect(notificationsStore[0].payload.type).toBe("TICKET_ESCALATED");
    expect(notificationsStore[0].payload.message).toContain("HD-0101");
  });

  it("does NOT escalate Level 0 ticket when SLA is paused (pausedAt is set)", async () => {
    // Overdue by time, but paused in AWAITING_ACCESS
    ticketsStore.push({
      id: "ticket-102",
      code: "HD-0102",
      title: "Room locked door issue",
      blockId: "block-a",
      status: TicketStatus.AWAITING_ACCESS,
      escalationLevel: 0,
      escalatedAt: null,
      pausedAt: new Date(fixedNow.getTime() - 2 * 60 * 60 * 1000), // paused 2h ago
      dueAt: new Date(fixedNow.getTime() - 60 * 60 * 1000),
    });

    const result = await EscalationJob.run();

    expect(result.totalEscalatedCount).toBe(0);
    expect(ticketsStore[0].escalationLevel).toBe(0);
    expect(eventsStore).toHaveLength(0);
    expect(notificationsStore).toHaveLength(0);
  });

  it("does NOT escalate Level 0 ticket if dueAt is still in the future", async () => {
    ticketsStore.push({
      id: "ticket-103",
      code: "HD-0103",
      title: "Light flickering",
      blockId: "block-a",
      status: TicketStatus.IN_PROGRESS,
      escalationLevel: 0,
      escalatedAt: null,
      pausedAt: null,
      dueAt: new Date(fixedNow.getTime() + 60 * 60 * 1000), // 1 hour remaining
    });

    const result = await EscalationJob.run();

    expect(result.totalEscalatedCount).toBe(0);
    expect(ticketsStore[0].escalationLevel).toBe(0);
  });

  it("escalates Level 1 ticket to Level 2 when 24 hours have elapsed since Level 1 escalation", async () => {
    // Ticket escalated to Level 1 25 hours ago
    ticketsStore.push({
      id: "ticket-201",
      code: "HD-0201",
      title: "Main circuit breaker tripped",
      blockId: "block-b",
      status: TicketStatus.IN_PROGRESS,
      escalationLevel: 1,
      escalatedAt: new Date(fixedNow.getTime() - 25 * 60 * 60 * 1000), // 25 hours ago
      pausedAt: null,
      dueAt: new Date(fixedNow.getTime() - 30 * 60 * 60 * 1000),
    });

    const result = await EscalationJob.run();

    expect(result.level1EscalatedCount).toBe(0);
    expect(result.level2EscalatedCount).toBe(1);

    // Verify DB update
    expect(ticketsStore[0].escalationLevel).toBe(2);

    // Verify TicketEvent
    expect(eventsStore).toHaveLength(1);
    expect(eventsStore[0].type).toBe(EventType.ESCALATED);
    expect(eventsStore[0].note).toContain("Level 2 (Chief Warden)");

    // Verify Chief Warden Notification
    expect(notificationsStore).toHaveLength(1);
    expect(notificationsStore[0].userIds).toEqual(["chief-warden-1"]);
    expect(notificationsStore[0].payload.type).toBe("TICKET_ESCALATED");
    expect(notificationsStore[0].payload.message).toContain("HD-0201");
  });

  it("does NOT escalate Level 1 ticket to Level 2 if less than 24 hours have elapsed", async () => {
    ticketsStore.push({
      id: "ticket-202",
      code: "HD-0202",
      title: "Main line pipe cracked",
      blockId: "block-b",
      status: TicketStatus.IN_PROGRESS,
      escalationLevel: 1,
      escalatedAt: new Date(fixedNow.getTime() - 12 * 60 * 60 * 1000), // only 12 hours ago
      pausedAt: null,
      dueAt: new Date(fixedNow.getTime() - 15 * 60 * 60 * 1000),
    });

    const result = await EscalationJob.run();

    expect(result.level2EscalatedCount).toBe(0);
    expect(ticketsStore[0].escalationLevel).toBe(1);
  });

  it("is idempotent: running escalation job multiple times does not double-escalate or duplicate events", async () => {
    ticketsStore.push({
      id: "ticket-301",
      code: "HD-0301",
      title: "Drain blocked",
      blockId: "block-a",
      status: TicketStatus.ASSIGNED,
      escalationLevel: 0,
      escalatedAt: null,
      pausedAt: null,
      dueAt: new Date(fixedNow.getTime() - 10 * 60 * 1000),
    });

    const res1 = await EscalationJob.run();
    expect(res1.level1EscalatedCount).toBe(1);
    expect(eventsStore).toHaveLength(1);

    const res2 = await EscalationJob.run();
    expect(res2.totalEscalatedCount).toBe(0);
    expect(eventsStore).toHaveLength(1);
    expect(notificationsStore).toHaveLength(1);
  });

  it("filters by blockId when option is provided", async () => {
    ticketsStore.push(
      {
        id: "ticket-a",
        code: "HD-000A",
        title: "Block A leak",
        blockId: "block-a",
        status: TicketStatus.ASSIGNED,
        escalationLevel: 0,
        pausedAt: null,
        dueAt: new Date(fixedNow.getTime() - 10 * 60 * 1000),
      },
      {
        id: "ticket-b",
        code: "HD-000B",
        title: "Block B leak",
        blockId: "block-b",
        status: TicketStatus.ASSIGNED,
        escalationLevel: 0,
        pausedAt: null,
        dueAt: new Date(fixedNow.getTime() - 10 * 60 * 1000),
      }
    );

    const res = await EscalationJob.run({ blockId: "block-a" });
    expect(res.level1EscalatedCount).toBe(1);
    expect(ticketsStore.find((t) => t.id === "ticket-a").escalationLevel).toBe(1);
    expect(ticketsStore.find((t) => t.id === "ticket-b").escalationLevel).toBe(0);
  });
});
