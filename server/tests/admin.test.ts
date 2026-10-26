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
