import { describe, it, expect, vi, beforeEach } from "vitest";
import { TicketStatus, CloseReason, EventType, DisputeStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { clock } from "../src/lib/clock";
import { NotificationService } from "../src/modules/notifications/notification.service";
import { AutoCloseJob } from "../src/jobs/autoclose.job";

describe("AutoCloseJob (Phase 5 - 48h Auto-Close & Unable to Access)", () => {
  const fixedNow = new Date("2026-10-27T12:00:00.000Z");

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
        if (where?.status && typeof where.status === "string" && t.status !== where.status) return false;
        if (where?.resolvedAt?.lte && !(t.resolvedAt && t.resolvedAt <= where.resolvedAt.lte)) return false;
        if (where?.pausedAt?.lte && !(t.pausedAt && t.pausedAt <= where.pausedAt.lte)) return false;
        if (where?.disputes?.none?.status && t.disputes?.some((d: any) => d.status === where.disputes.none.status)) {
          return false;
        }
        return true;
      });
    });

    // Mock prisma.ticket.updateMany
    vi.spyOn(prisma.ticket, "updateMany").mockImplementation(async ({ where, data }: any) => {
      const match = ticketsStore.find((t) => {
        if (t.id !== where.id) return false;
        if (where.status?.in && !where.status.in.includes(t.status)) return false;
        if (where.status && typeof where.status === "string" && t.status !== where.status) return false;
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

    // Mock NotificationService
    vi.spyOn(NotificationService, "getTicketAudience").mockResolvedValue(["occupant-1", "occupant-2"]);
    vi.spyOn(NotificationService, "notify").mockImplementation(async (userIds, payload) => {
      notificationsStore.push({ userIds, payload });
    });
  });

  it("auto-closes RESOLVED ticket after 48h with no open dispute", async () => {
    // Ticket resolved 50 hours ago
    ticketsStore.push({
      id: "ticket-res-1",
      code: "HD-1001",
      status: TicketStatus.RESOLVED,
      closeReason: null,
      completionCode: "1234",
      resolvedAt: new Date(fixedNow.getTime() - 50 * 60 * 60 * 1000), // 50h ago
      disputes: [],
    });

    const result = await AutoCloseJob.run();

    expect(result.autoClosedCount).toBe(1);
    expect(result.unableToAccessCount).toBe(0);

    // Verify DB update
    expect(ticketsStore[0].status).toBe(TicketStatus.CLOSED);
    expect(ticketsStore[0].closeReason).toBe(CloseReason.AUTO_CLOSED);
    expect(ticketsStore[0].completionCode).toBeNull();
    expect(ticketsStore[0].closedAt).toEqual(fixedNow);

    // Verify Event
    expect(eventsStore).toHaveLength(1);
    expect(eventsStore[0].type).toBe(EventType.AUTO_CLOSED);
    expect(eventsStore[0].fromStatus).toBe(TicketStatus.RESOLVED);
    expect(eventsStore[0].toStatus).toBe(TicketStatus.CLOSED);

    // Verify Notification
    expect(notificationsStore).toHaveLength(1);
    expect(notificationsStore[0].payload.type).toBe("TICKET_AUTO_CLOSED");
    expect(notificationsStore[0].payload.message).toContain("HD-1001");
  });

  it("auto-closes AWAITING_VERIFICATION (common area) ticket after 48h with no open dispute", async () => {
    ticketsStore.push({
      id: "ticket-ver-1",
      code: "HD-1002",
      status: TicketStatus.AWAITING_VERIFICATION,
      closeReason: null,
      resolvedAt: new Date(fixedNow.getTime() - 49 * 60 * 60 * 1000),
      disputes: [],
    });

    const result = await AutoCloseJob.run();

    expect(result.autoClosedCount).toBe(1);
    expect(ticketsStore[0].status).toBe(TicketStatus.CLOSED);
    expect(ticketsStore[0].closeReason).toBe(CloseReason.AUTO_CLOSED);
  });

  it("does NOT auto-close resolved ticket if less than 48h have elapsed", async () => {
    ticketsStore.push({
      id: "ticket-res-recent",
      code: "HD-1003",
      status: TicketStatus.RESOLVED,
      closeReason: null,
      resolvedAt: new Date(fixedNow.getTime() - 24 * 60 * 60 * 1000), // only 24h ago
      disputes: [],
    });

    const result = await AutoCloseJob.run();

    expect(result.totalClosedCount).toBe(0);
    expect(ticketsStore[0].status).toBe(TicketStatus.RESOLVED);
  });

  it("does NOT auto-close resolved ticket if an OPEN dispute exists", async () => {
    ticketsStore.push({
      id: "ticket-res-disputed",
      code: "HD-1004",
      status: TicketStatus.RESOLVED,
      closeReason: null,
      resolvedAt: new Date(fixedNow.getTime() - 60 * 60 * 60 * 1000), // 60h ago
      disputes: [
        {
          id: "disp-1",
          status: DisputeStatus.OPEN,
          type: "FIX_NOT_DONE",
        },
      ],
    });

    const result = await AutoCloseJob.run();

    expect(result.totalClosedCount).toBe(0);
    expect(ticketsStore[0].status).toBe(TicketStatus.RESOLVED);
  });

  it("closes AWAITING_ACCESS ticket after 48h without occupant response (reason UNABLE_TO_ACCESS)", async () => {
    // Ticket paused in AWAITING_ACCESS 50 hours ago
    ticketsStore.push({
      id: "ticket-access-1",
      code: "HD-2001",
      status: TicketStatus.AWAITING_ACCESS,
      closeReason: null,
      pausedAt: new Date(fixedNow.getTime() - 50 * 60 * 60 * 1000),
      disputes: [],
    });

    const result = await AutoCloseJob.run();

    expect(result.unableToAccessCount).toBe(1);
    expect(ticketsStore[0].status).toBe(TicketStatus.CLOSED);
    expect(ticketsStore[0].closeReason).toBe(CloseReason.UNABLE_TO_ACCESS);
    expect(ticketsStore[0].closedAt).toEqual(fixedNow);

    // Verify Event
    expect(eventsStore).toHaveLength(1);
    expect(eventsStore[0].type).toBe(EventType.STATUS_CHANGED);
    expect(eventsStore[0].note).toContain("unable to access room after 48 hours");

    // Verify Notification
    expect(notificationsStore).toHaveLength(1);
    expect(notificationsStore[0].payload.type).toBe("TICKET_CLOSED");
  });

  it("does NOT close AWAITING_ACCESS ticket if less than 48h have elapsed", async () => {
    ticketsStore.push({
      id: "ticket-access-recent",
      code: "HD-2002",
      status: TicketStatus.AWAITING_ACCESS,
      closeReason: null,
      pausedAt: new Date(fixedNow.getTime() - 10 * 60 * 60 * 1000), // 10h ago
      disputes: [],
    });

    const result = await AutoCloseJob.run();

    expect(result.totalClosedCount).toBe(0);
    expect(ticketsStore[0].status).toBe(TicketStatus.AWAITING_ACCESS);
  });

  it("is idempotent: repeated runs do not double-close or create extra events", async () => {
    ticketsStore.push({
      id: "ticket-idem",
      code: "HD-3001",
      status: TicketStatus.RESOLVED,
      resolvedAt: new Date(fixedNow.getTime() - 55 * 60 * 60 * 1000),
      disputes: [],
    });

    const res1 = await AutoCloseJob.run();
    expect(res1.autoClosedCount).toBe(1);
    expect(eventsStore).toHaveLength(1);

    const res2 = await AutoCloseJob.run();
    expect(res2.totalClosedCount).toBe(0);
    expect(eventsStore).toHaveLength(1);
  });
});
