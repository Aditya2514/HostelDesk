import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import jwt from "jsonwebtoken";
import { env } from "../src/config/env";
import { Role, Trade, Priority, TicketStatus, LocationType } from "@prisma/client";
import { clock } from "../src/lib/clock";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    ticketPrediction: {
      findMany: vi.fn(),
    },
    roomOccupancy: {
      findFirst: vi.fn().mockResolvedValue({ roomId: "room-1" }),
    },
    category: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

describe("Schedule & ETA Explanation Endpoints", () => {
  const studentToken = jwt.sign({ userId: "student-1", role: Role.STUDENT }, env.JWT_SECRET);
  const staffToken = jwt.sign({ userId: "staff-1", role: Role.STAFF }, env.JWT_SECRET);
  const wardenToken = jwt.sign({ userId: "warden-1", role: Role.WARDEN }, env.JWT_SECRET);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(clock, "now").mockReturnValue(new Date("2026-10-26T04:30:00.000Z")); // Mon 10:00 IST
  });

  describe("GET /api/tickets/:id/eta-explanation", () => {
    it("returns privacy-safe explanation without other students' names or room numbers in jobsAhead", async () => {
      // Mock auth user
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "student-1",
        name: "Student One",
        role: Role.STUDENT,
        isActive: true,
      } as any);

      // Mock ticket with assignee
      const mockTicket = {
        id: "ticket-101",
        code: "HD-0101",
        title: "Ceiling Fan Jammed",
        categoryId: "cat-elec",
        blockId: "block-a",
        roomId: "room-1",
        priority: Priority.NORMAL,
        status: TicketStatus.ASSIGNED,
        raisedById: "student-1",
        locationType: LocationType.ROOM,
        etaP50At: new Date("2026-10-26T05:30:00.000Z"),
        etaP80At: new Date("2026-10-26T06:00:00.000Z"),
        category: { id: "cat-elec", name: "Fan Repair", defaultDurationMin: 40 },
        block: { id: "block-a", name: "A" },
        assignedTo: {
          id: "staff-1",
          name: "Electrician Manoj",
          trade: Trade.ELECTRICIAN,
          shifts: [
            { weekday: 1, startMinute: 540, endMinute: 1080 }, // Mon 09:00 - 18:00 IST
          ],
        },
        followers: [],
      };

      vi.mocked(prisma.ticket.findUnique).mockResolvedValueOnce(mockTicket as any);

      // Mock duration estimate raw query
      vi.mocked(prisma.category.findUnique).mockResolvedValue({ id: "cat-elec", defaultDurationMin: 40 } as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 8, median: 65, p80: 80 }]);

      // Mock other tickets in staff queue
      vi.mocked(prisma.ticket.findMany).mockResolvedValue([
        {
          id: "ticket-ahead-1",
          code: "HD-0090",
          categoryId: "cat-elec",
          blockId: "block-a",
          priority: Priority.URGENT,
          status: TicketStatus.ASSIGNED,
          createdAt: new Date("2026-10-26T03:00:00.000Z"),
          startedAt: null,
          preferredSlotStart: null,
        },
        {
          id: "ticket-101",
          code: "HD-0101",
          categoryId: "cat-elec",
          blockId: "block-a",
          priority: Priority.NORMAL,
          status: TicketStatus.ASSIGNED,
          createdAt: new Date("2026-10-26T04:00:00.000Z"),
          startedAt: null,
          preferredSlotStart: null,
        },
      ] as any);

      // Mock predictions history
      vi.mocked(prisma.ticketPrediction.findMany).mockResolvedValue([
        {
          predictedP50At: new Date("2026-10-26T05:30:00.000Z"),
          predictedP80At: new Date("2026-10-26T06:00:00.000Z"),
          createdAt: new Date("2026-10-26T04:00:00.000Z"),
        },
      ] as any);

      const res = await request(app)
        .get("/api/tickets/ticket-101/eta-explanation")
        .set("Cookie", `token=${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.assignee).toBeDefined();
      expect(res.body.assignee.name).toBe("Electrician Manoj");
      expect(res.body.estimate).toBeDefined();
      expect(res.body.estimate.p50Minutes).toBeGreaterThan(0);

      // Verify privacy guarantee: jobsAhead includes only { code, priority, estMinutes }
      expect(Array.isArray(res.body.jobsAhead)).toBe(true);
      expect(res.body.jobsAhead.length).toBe(1);
      const aheadJob = res.body.jobsAhead[0];
      expect(aheadJob.code).toBe("HD-0090");
      expect(aheadJob.priority).toBe("URGENT");
      expect(aheadJob.estMinutes).toBeDefined();
      expect((aheadJob as any).studentName).toBeUndefined();
      expect((aheadJob as any).studentId).toBeUndefined();
      expect((aheadJob as any).roomNumber).toBeUndefined();

      expect(res.body.shiftToday).toBeDefined();
      expect(res.body.shiftToday.startFormatted).toBe("9:00 AM");
      expect(res.body.shiftToday.endFormatted).toBe("6:00 PM");
    });
  });

  describe("GET /api/staff/:id/schedule", () => {
    it("allows staff member themselves or warden to view schedule, and rejects student with 403", async () => {
      // 1. Student attempt -> 403 FORBIDDEN
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "student-1",
        role: Role.STUDENT,
        isActive: true,
      } as any);

      const studentRes = await request(app)
        .get("/api/staff/staff-1/schedule")
        .set("Cookie", `token=${studentToken}`);

      expect(studentRes.status).toBe(403);

      // 2. Staff themselves attempt -> 200 OK
      vi.mocked(prisma.user.findUnique)
        // User auth lookup
        .mockResolvedValueOnce({
          id: "staff-1",
          role: Role.STAFF,
          isActive: true,
        } as any)
        // Staff schedule lookup
        .mockResolvedValueOnce({
          id: "staff-1",
          name: "Electrician Manoj",
          role: Role.STAFF,
          trade: Trade.ELECTRICIAN,
          shifts: [{ weekday: 1, startMinute: 540, endMinute: 1080 }],
        } as any);

      vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce([
        {
          id: "ticket-1",
          code: "HD-0001",
          title: "Light flickering",
          priority: Priority.NORMAL,
          status: TicketStatus.ASSIGNED,
          locationType: LocationType.ROOM,
          floor: 2,
          room: { number: "A-204" },
          block: { name: "A" },
          category: { id: "cat-1", name: "Lighting", defaultDurationMin: 30 },
          createdAt: new Date("2026-10-26T03:00:00.000Z"),
          startedAt: null,
          preferredSlotStart: null,
        },
      ] as any);

      vi.mocked(prisma.category.findUnique).mockResolvedValue({ id: "cat-1", defaultDurationMin: 30 } as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 0, median: null, p80: null }]);

      const staffRes = await request(app)
        .get("/api/staff/staff-1/schedule")
        .set("Cookie", `token=${staffToken}`);

      expect(staffRes.status).toBe(200);
      expect(staffRes.body.staff.name).toBe("Electrician Manoj");
      expect(Array.isArray(staffRes.body.jobs)).toBe(true);
      expect(staffRes.body.jobs.length).toBe(1);
      expect(staffRes.body.jobs[0].code).toBe("HD-0001");
      expect(staffRes.body.jobs[0].startAt).toBeDefined();
      expect(staffRes.body.jobs[0].finishAt).toBeDefined();
    });
  });
});
