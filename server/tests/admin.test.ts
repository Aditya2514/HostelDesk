import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { AuditService } from "../src/modules/admin/audit.service";
import { OccupancyService } from "../src/modules/admin/occupancy.service";
import { prisma } from "../src/lib/prisma";
import { Role } from "@prisma/client";

describe("Admin Module — Audit Log & Access Control", () => {
  it("rejects unauthenticated requests to /api/admin/audit-log with 401", async () => {
    const res = await request(app).get("/api/admin/audit-log");
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated requests to /api/admin/rooms with 401", async () => {
    const res = await request(app).get("/api/admin/rooms");
    expect(res.status).toBe(401);
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

