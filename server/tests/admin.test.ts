import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { AuditService } from "../src/modules/admin/audit.service";
import { Role } from "@prisma/client";

describe("Admin Module — Audit Log & Access Control", () => {
  it("rejects unauthenticated requests to /api/admin/audit-log with 401", async () => {
    const res = await request(app).get("/api/admin/audit-log");
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
