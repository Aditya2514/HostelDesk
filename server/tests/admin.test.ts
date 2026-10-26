import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { AuditService } from "../src/modules/admin/audit.service";
import { OccupancyService } from "../src/modules/admin/occupancy.service";
import { prisma } from "../src/lib/prisma";
import { Role, Trade } from "@prisma/client";

afterEach(() => {
  vi.restoreAllMocks();
});

import jwt from "jsonwebtoken";
import { env } from "../src/config/env";

describe("Admin Module — Audit Log & Access Control", () => {
  it("rejects unauthenticated requests to /api/admin/audit-log with 401", async () => {
    const res = await request(app).get("/api/admin/audit-log");
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated requests to /api/admin/rooms with 401", async () => {
    const res = await request(app).get("/api/admin/rooms");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin roles (STUDENT, WARDEN) with 403 FORBIDDEN on every admin endpoint", async () => {
    const studentUser = { id: "student-1", name: "Student", email: "student@test.com", role: Role.STUDENT, isActive: true };
    const wardenUser = { id: "warden-1", name: "Warden", email: "warden@test.com", role: Role.WARDEN, blockId: "block-a", isActive: true };

    const studentToken = jwt.sign({ id: "student-1", role: Role.STUDENT }, env.JWT_SECRET);
    const wardenToken = jwt.sign({ id: "warden-1", role: Role.WARDEN }, env.JWT_SECRET);

    const endpoints = [
      { method: "get", url: "/api/admin/audit-log" },
      { method: "get", url: "/api/admin/rooms" },
      { method: "get", url: "/api/admin/students" },
      { method: "post", url: "/api/admin/occupancy/move" },
      { method: "post", url: "/api/admin/occupancy/occ-1/end" },
      { method: "post", url: "/api/admin/import/students" },
      { method: "get", url: "/api/admin/staff" },
      { method: "post", url: "/api/admin/staff" },
      { method: "patch", url: "/api/admin/staff/staff-1" },
      { method: "put", url: "/api/admin/staff/staff-1/shifts" },
      { method: "get", url: "/api/admin/categories" },
      { method: "post", url: "/api/admin/categories" },
      { method: "patch", url: "/api/admin/categories/cat-1" },
    ];

    for (const ep of endpoints) {
      // Test STUDENT
      vi.spyOn(prisma.user, "findUnique").mockResolvedValue(studentUser as any);
      const studentRes = await (request(app) as any)[ep.method](ep.url).set("Cookie", [`token=${studentToken}`]);
      expect(studentRes.status, `Expected 403 for student on ${ep.method.toUpperCase()} ${ep.url}`).toBe(403);

      // Test WARDEN
      vi.spyOn(prisma.user, "findUnique").mockResolvedValue(wardenUser as any);
      const wardenRes = await (request(app) as any)[ep.method](ep.url).set("Cookie", [`token=${wardenToken}`]);
      expect(wardenRes.status, `Expected 403 for warden on ${ep.method.toUpperCase()} ${ep.url}`).toBe(403);
    }
  });

  it("AuditService.logAction writes an audit log entry in transaction and retrieves it", async () => {
    const mockTx: any = {
      adminAuditLog: {
        create: vi.fn().mockResolvedValue({
          id: "log-1",
          actorId: "admin-1",
          action: "MOVE_STUDENT",
          entityType: "ROOM_OCCUPANCY",
          entityId: "occ-1",
          payload: { fromRoom: "A-101", toRoom: "A-102" },
          createdAt: new Date(),
        }),
      },
    };

    const result = await AuditService.logAction(
      {
        actorId: "admin-1",
        action: "MOVE_STUDENT",
        entityType: "ROOM_OCCUPANCY",
        entityId: "occ-1",
        payload: { fromRoom: "A-101", toRoom: "A-102" },
      },
      mockTx
    );

    expect(result.id).toBe("log-1");
    expect(mockTx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: "admin-1",
          action: "MOVE_STUDENT",
          entityType: "ROOM_OCCUPANCY",
        }),
      })
    );
  });
});

describe("Admin Module — Occupancy Service Move Rules", () => {
  it("rejects moving student into the same room with 400 SAME_ROOM", async () => {
    const mockTx: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: "user-1", role: Role.STUDENT, isActive: true }),
      },
      room: {
        findUnique: vi.fn().mockResolvedValue({ id: "room-101", number: "101", block: { name: "A" } }),
      },
      roomOccupancy: {
        findFirst: vi.fn().mockResolvedValue({
          id: "occ-1",
          userId: "user-1",
          roomId: "room-101", // already in room-101
        }),
      },
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

    await expect(
      OccupancyService.moveStudent({
        actorId: "admin-1",
        userId: "user-1",
        roomId: "room-101",
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SAME_ROOM",
    });
  });

  it("rejects moving student into a full room (>= 2 occupants) with 409 ROOM_FULL", async () => {
    const mockTx: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: "user-1", role: Role.STUDENT, isActive: true }),
      },
      room: {
        findUnique: vi.fn().mockResolvedValue({ id: "room-202", number: "202", block: { name: "B" } }),
      },
      roomOccupancy: {
        findFirst: vi.fn().mockResolvedValue({
          id: "occ-1",
          userId: "user-1",
          roomId: "room-101",
        }),
        count: vi.fn().mockResolvedValue(2), // 2 occupants already
      },
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

    await expect(
      OccupancyService.moveStudent({
        actorId: "admin-1",
        userId: "user-1",
        roomId: "room-202",
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "ROOM_FULL",
    });
  });

  it("terminates previous occupancy and creates new occupancy in the same transaction", async () => {
    const updatedPrevOccupancy = { id: "occ-old", toDate: new Date() };
    const createdNewOccupancy = { id: "occ-new", userId: "user-1", roomId: "room-202" };

    const mockTx: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: "user-1", role: Role.STUDENT, isActive: true }),
      },
      room: {
        findUnique: vi.fn().mockResolvedValue({ id: "room-202", number: "202", block: { name: "B" } }),
      },
      roomOccupancy: {
        findFirst: vi.fn().mockResolvedValue({
          id: "occ-old",
          userId: "user-1",
          roomId: "room-101",
        }),
        count: vi.fn().mockResolvedValue(1), // 1 occupant currently, so has space
        update: vi.fn().mockResolvedValue(updatedPrevOccupancy),
        create: vi.fn().mockResolvedValue(createdNewOccupancy),
      },
      adminAuditLog: {
        create: vi.fn().mockResolvedValue({ id: "audit-1" }),
      },
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

    const result = await OccupancyService.moveStudent({
      actorId: "admin-1",
      userId: "user-1",
      roomId: "room-202",
    });

    expect(result.previousOccupancyId).toBe("occ-old");
    expect(result.newOccupancy.id).toBe("occ-new");
    expect(mockTx.roomOccupancy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "occ-old" },
      })
    );
    expect(mockTx.roomOccupancy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          roomId: "room-202",
        }),
      })
    );
    expect(mockTx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "MOVE_STUDENT",
          actorId: "admin-1",
        }),
      })
    );
  });

  it("ends occupancy atomically and logs END_OCCUPANCY audit action", async () => {
    const mockTx: any = {
      roomOccupancy: {
        findUnique: vi.fn().mockResolvedValue({
          id: "occ-1",
          userId: "user-1",
          roomId: "room-101",
          toDate: null,
          room: { number: "101", block: { name: "A" } },
          user: { name: "Alice", email: "alice@example.com" },
        }),
        update: vi.fn().mockResolvedValue({
          id: "occ-1",
          toDate: new Date(),
        }),
      },
      adminAuditLog: {
        create: vi.fn().mockResolvedValue({ id: "audit-2" }),
      },
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

    const result = await OccupancyService.endOccupancy({
      actorId: "admin-1",
      occupancyId: "occ-1",
    });

    expect(result.id).toBe("occ-1");
    expect(mockTx.roomOccupancy.update).toHaveBeenCalled();
    expect(mockTx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "END_OCCUPANCY",
          actorId: "admin-1",
        }),
      })
    );
  });
});

import { CsvImportService } from "../src/modules/admin/csv-import.service";

describe("Admin Module — CSV Student Import Validation & Rules", () => {
  it("rejects CSV with missing required headers", () => {
    const invalidCsv = "name,email,block\nJohn,john@example.com,A";
    expect(() => CsvImportService.parseCsv(invalidCsv)).toThrowError();
  });

  it("identifies each error type properly during CSV validation", async () => {
    vi.spyOn(prisma.block, "findMany").mockResolvedValue([
      { id: "block-a", name: "A" } as any,
      { id: "block-b", name: "B" } as any,
    ]);

    vi.spyOn(prisma.room, "findMany").mockResolvedValue([
      { id: "room-101", number: "101", blockId: "block-a", block: { name: "A" } } as any,
      { id: "room-102", number: "102", blockId: "block-a", block: { name: "A" } } as any,
      { id: "room-201", number: "201", blockId: "block-b", block: { name: "B" } } as any,
    ]);

    vi.spyOn(prisma.user, "findMany").mockResolvedValue([]);

    // Room 101 already has 2 occupants
    vi.spyOn(prisma.roomOccupancy, "findMany").mockResolvedValue([
      { id: "occ-1", userId: "u1", roomId: "room-101" } as any,
      { id: "occ-2", userId: "u2", roomId: "room-101" } as any,
    ]);

    const testCsv = `email,name,block,room,fromDate
bad-email,Bad Email Student,A,102,2026-11-01
valid1@example.com,Unknown Room Student,Z,999,2026-11-01
valid2@example.com,Bad Date Student,A,102,not-a-date
dup@example.com,Dup One,B,201,2026-11-01
dup@example.com,Dup Two,B,201,2026-11-01
overflow@example.com,Overflow Student,A,101,2026-11-01
clean@example.com,Clean Student,A,102,2026-11-01`;

    const result = await CsvImportService.validateCsv(testCsv);
    expect(result.hasErrors).toBe(true);

    const rowErrors = result.rows.map((r) => ({
      email: r.email,
      status: r.status,
      reason: r.errorReason,
    }));

    expect(rowErrors[0]).toEqual({ email: "bad-email", status: "ERROR", reason: "bad email" });
    expect(rowErrors[1]).toEqual({ email: "valid1@example.com", status: "ERROR", reason: "unknown block/room" });
    expect(rowErrors[2]).toEqual({ email: "valid2@example.com", status: "ERROR", reason: "invalid date" });
    expect(rowErrors[3]).toEqual({ email: "dup@example.com", status: "ERROR", reason: "duplicate email within the file" });
    expect(rowErrors[4]).toEqual({ email: "dup@example.com", status: "ERROR", reason: "duplicate email within the file" });
    expect(rowErrors[5]).toEqual({
      email: "overflow@example.com",
      status: "ERROR",
      reason: "room would exceed 2 occupants after the import",
    });
    expect(rowErrors[6]).toEqual({
      email: "clean@example.com",
      status: "CREATE",
      reason: undefined,
    });
  });

  it("refuses to apply import if any row has an ERROR (all-or-nothing)", async () => {
    vi.spyOn(prisma.block, "findMany").mockResolvedValue([{ id: "block-a", name: "A" } as any]);
    vi.spyOn(prisma.room, "findMany").mockResolvedValue([
      { id: "room-101", number: "101", blockId: "block-a", block: { name: "A" } } as any,
    ]);
    vi.spyOn(prisma.user, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.roomOccupancy, "findMany").mockResolvedValue([]);

    const csvWithOneError = `email,name,block,room,fromDate
clean@example.com,Clean Student,A,101,2026-11-01
bad-email,Bad Email Student,A,101,2026-11-01`;

    await expect(CsvImportService.applyImport("admin-1", csvWithOneError)).rejects.toMatchObject({
      statusCode: 400,
      code: "IMPORT_CONTAINS_ERRORS",
    });
  });

  it("successfully applies clean CSV, creates credentials and audits inside transaction", async () => {
    vi.spyOn(prisma.block, "findMany").mockResolvedValue([{ id: "block-a", name: "A" } as any]);
    vi.spyOn(prisma.room, "findMany").mockResolvedValue([
      { id: "room-101", number: "101", blockId: "block-a", block: { name: "A" } } as any,
    ]);
    vi.spyOn(prisma.user, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.roomOccupancy, "findMany").mockResolvedValue([]);

    const mockTx: any = {
      block: { findMany: vi.fn().mockResolvedValue([{ id: "block-a", name: "A" }]) },
      room: { findMany: vi.fn().mockResolvedValue([{ id: "room-101", number: "101", blockId: "block-a" }]) },
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation((args: any) =>
          Promise.resolve({ id: "new-user-1", email: args.data.email, name: args.data.name })
        ),
      },
      roomOccupancy: {
        create: vi.fn().mockResolvedValue({ id: "occ-new-1" }),
      },
      adminAuditLog: {
        create: vi.fn().mockResolvedValue({ id: "audit-csv" }),
      },
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

    const cleanCsv = `email,name,block,room,fromDate
fresh.student@example.com,Fresh Student,A,101,2026-11-01`;

    const result = await CsvImportService.applyImport("admin-1", cleanCsv);

    expect(result.summary.create).toBe(1);
    expect(result.credentials.length).toBe(1);
    expect(result.credentials[0].email).toBe("fresh.student@example.com");
    expect(result.credentials[0].temporaryPassword.length).toBe(12);
    expect(result.credentialsCsv).toContain("fresh.student@example.com");
    expect(mockTx.user.create).toHaveBeenCalled();
    expect(mockTx.roomOccupancy.create).toHaveBeenCalled();
    expect(mockTx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "IMPORT_STUDENTS",
          actorId: "admin-1",
        }),
      })
    );
  });
});

import { StaffService } from "../src/modules/admin/staff.service";
import { RoutingService } from "../src/modules/scheduling/routing.service";

describe("Admin Module — Staff Management & Shift Editor Rules", () => {
  it("rejects shift windows with invalid bounds or start >= end", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "staff-1",
      role: Role.STAFF,
    } as any);

    // startMinute >= endMinute
    await expect(
      StaffService.updateStaffShifts({
        actorId: "admin-1",
        staffId: "staff-1",
        shifts: [{ weekday: 1, startMinute: 600, endMinute: 500 }],
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });

    // endMinute > 1440
    await expect(
      StaffService.updateStaffShifts({
        actorId: "admin-1",
        staffId: "staff-1",
        shifts: [{ weekday: 1, startMinute: 600, endMinute: 1500 }],
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects overlapping shift windows on the same weekday", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "staff-1",
      role: Role.STAFF,
    } as any);

    // Overlapping: [540, 720] (9am-12pm) and [660, 900] (11am-3pm) on Monday
    await expect(
      StaffService.updateStaffShifts({
        actorId: "admin-1",
        staffId: "staff-1",
        shifts: [
          { weekday: 1, startMinute: 540, endMinute: 720 },
          { weekday: 1, startMinute: 660, endMinute: 900 },
        ],
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "OVERLAPPING_SHIFTS",
    });
  });

  it("saves valid non-overlapping shift windows and creates audit record in transaction", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "staff-1",
      role: Role.STAFF,
    } as any);

    const mockTx: any = {
      staffShift: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      adminAuditLog: {
        create: vi.fn().mockResolvedValue({ id: "audit-shifts" }),
      },
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

    const result = await StaffService.updateStaffShifts({
      actorId: "admin-1",
      staffId: "staff-1",
      shifts: [
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 780, endMinute: 1020 },
      ],
    });

    expect(result.success).toBe(true);
    expect(mockTx.staffShift.deleteMany).toHaveBeenCalledWith({ where: { staffId: "staff-1" } });
    expect(mockTx.staffShift.createMany).toHaveBeenCalledWith({
      data: [
        { staffId: "staff-1", weekday: 1, startMinute: 540, endMinute: 720 },
        { staffId: "staff-1", weekday: 1, startMinute: 780, endMinute: 1020 },
      ],
    });
    expect(mockTx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "UPDATE_SHIFTS",
          actorId: "admin-1",
        }),
      })
    );
  });

  it("deactivating staff with open tickets without flag throws 409 HAS_OPEN_TICKETS", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "staff-1",
      name: "Plumber One",
      role: Role.STAFF,
      trade: Trade.PLUMBER,
      isActive: true,
    } as any);

    vi.spyOn(prisma.ticket, "findMany").mockResolvedValue([
      { id: "tick-1", code: "HD-0010", title: "Pipe leak", status: "ASSIGNED", category: { id: "c1", trade: Trade.PLUMBER } } as any,
    ]);

    await expect(
      StaffService.updateStaffStatus({
        actorId: "admin-1",
        staffId: "staff-1",
        isActive: false,
        reassignOpenTickets: false,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "HAS_OPEN_TICKETS",
    });
  });

  it("deactivating staff with open tickets and reassign flag re-routes tickets and audits", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "staff-1",
      name: "Plumber One",
      role: Role.STAFF,
      trade: Trade.PLUMBER,
      isActive: true,
    } as any);

    vi.spyOn(prisma.ticket, "findMany").mockResolvedValue([
      {
        id: "tick-1",
        code: "HD-0010",
        title: "Pipe leak",
        status: "ASSIGNED",
        categoryId: "c1",
        blockId: "b1",
        category: { id: "c1", trade: Trade.PLUMBER },
      } as any,
    ]);

    vi.spyOn(RoutingService, "chooseAssignee").mockResolvedValue({
      staffId: "staff-2",
      etaP50At: new Date(),
      etaP80At: new Date(),
      explanation: {} as any,
    });

    const mockTx: any = {
      user: { update: vi.fn().mockResolvedValue({ id: "staff-1", isActive: false }) },
      ticket: { update: vi.fn().mockResolvedValue({ id: "tick-1" }) },
      ticketPrediction: { create: vi.fn().mockResolvedValue({ id: "pred-1" }) },
      ticketEvent: { create: vi.fn().mockResolvedValue({ id: "event-1" }) },
      adminAuditLog: { create: vi.fn().mockResolvedValue({ id: "audit-deactivate" }) },
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

    const result = await StaffService.updateStaffStatus({
      actorId: "admin-1",
      staffId: "staff-1",
      isActive: false,
      reassignOpenTickets: true,
    });

    expect(result.success).toBe(true);
    expect(result.reassignedCount).toBe(1);
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: "staff-1" },
      data: { isActive: false },
    });
    expect(mockTx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tick-1" },
        data: expect.objectContaining({ assignedToId: "staff-2" }),
      })
    );
    expect(mockTx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "DEACTIVATE_STAFF",
          actorId: "admin-1",
        }),
      })
    );
  });
});

import { CategoryService } from "../src/modules/admin/category.service";

describe("Admin Module — Category Management & SLA Tuning Rules", () => {
  it("rejects category creation with duration or SLA outside allowed bounds", async () => {
    // duration < 5
    await expect(
      CategoryService.createCategory("admin-1", {
        name: "Quick fix",
        trade: Trade.ELECTRICIAN,
        defaultDurationMin: 2,
        slaMinutes: 120,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });

    // duration > 480
    await expect(
      CategoryService.createCategory("admin-1", {
        name: "Long fix",
        trade: Trade.ELECTRICIAN,
        defaultDurationMin: 600,
        slaMinutes: 120,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });

    // sla < 30
    await expect(
      CategoryService.createCategory("admin-1", {
        name: "Fast SLA",
        trade: Trade.ELECTRICIAN,
        defaultDurationMin: 30,
        slaMinutes: 15,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });

    // sla > 20160
    await expect(
      CategoryService.createCategory("admin-1", {
        name: "Slow SLA",
        trade: Trade.ELECTRICIAN,
        defaultDurationMin: 30,
        slaMinutes: 25000,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects duplicate category name with 409 CATEGORY_EXISTS", async () => {
    vi.spyOn(prisma.category, "findUnique").mockResolvedValue({
      id: "cat-1",
      name: "Fan fault",
    } as any);

    await expect(
      CategoryService.createCategory("admin-1", {
        name: "Fan fault",
        trade: Trade.ELECTRICIAN,
        defaultDurationMin: 30,
        slaMinutes: 120,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CATEGORY_EXISTS",
    });
  });

  it("creates category and logs CREATE_CATEGORY audit action inside transaction", async () => {
    vi.spyOn(prisma.category, "findUnique").mockResolvedValue(null);

    const createdCat = {
      id: "cat-new",
      name: "New Category",
      trade: Trade.PLUMBER,
      defaultDurationMin: 45,
      slaMinutes: 240,
      defaultPriority: "NORMAL",
      isActive: true,
    };

    const mockTx: any = {
      category: {
        create: vi.fn().mockResolvedValue(createdCat),
      },
      adminAuditLog: {
        create: vi.fn().mockResolvedValue({ id: "audit-cat-create" }),
      },
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

    const result = await CategoryService.createCategory("admin-1", {
      name: "New Category",
      trade: Trade.PLUMBER,
      defaultDurationMin: 45,
      slaMinutes: 240,
    });

    expect(result.id).toBe("cat-new");
    expect(mockTx.category.create).toHaveBeenCalled();
    expect(mockTx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CREATE_CATEGORY",
          actorId: "admin-1",
        }),
      })
    );
  });

  it("updates category and logs UPDATE_CATEGORY audit action inside transaction", async () => {
    vi.spyOn(prisma.category, "findUnique").mockImplementation(async (args: any) => {
      if (args.where?.id === "cat-1") {
        return {
          id: "cat-1",
          name: "Existing Cat",
          trade: Trade.CARPENTER,
          defaultDurationMin: 60,
          slaMinutes: 300,
          defaultPriority: "NORMAL",
          isActive: true,
        } as any;
      }
      return null;
    });

    const mockTx: any = {
      category: {
        update: vi.fn().mockResolvedValue({
          id: "cat-1",
          name: "Updated Cat",
          trade: Trade.CARPENTER,
          defaultDurationMin: 90,
          slaMinutes: 300,
          defaultPriority: "NORMAL",
          isActive: true,
        }),
      },
      adminAuditLog: {
        create: vi.fn().mockResolvedValue({ id: "audit-cat-update" }),
      },
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

    const result = await CategoryService.updateCategory("admin-1", "cat-1", {
      name: "Updated Cat",
      defaultDurationMin: 90,
    });

    expect(result.defaultDurationMin).toBe(90);
    expect(mockTx.category.update).toHaveBeenCalled();
    expect(mockTx.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "UPDATE_CATEGORY",
          actorId: "admin-1",
        }),
      })
    );
  });
});



