import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { requireAuth, requireRole } from "../src/middleware/auth.middleware";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { AppError } from "../src/lib/errors";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    roomOccupancy: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

describe("Authorization & Auth Guards", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      cookies: {},
      headers: {},
    };
    res = {};
    next = vi.fn();
  });

  describe("requireAuth", () => {
    it("returns 401 when token is missing", async () => {
      await requireAuth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = vi.mocked(next).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    });

    it("returns 401 when token is invalid or expired", async () => {
      req.cookies = { token: "invalid.jwt.token" };

      await requireAuth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = vi.mocked(next).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    });

    it("returns 401 when user is inactive or not found", async () => {
      const token = jwt.sign({ userId: "user-123" }, env.JWT_SECRET);
      req.cookies = { token };

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "user-123",
        name: "Inactive User",
        email: "inactive@hosteldesk.dev",
        role: Role.STUDENT,
        trade: null,
        blockId: null,
        isActive: false,
      } as any);

      await requireAuth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = vi.mocked(next).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    });

    it("attaches user and calls next when token is valid and user is active", async () => {
      const token = jwt.sign({ userId: "user-123" }, env.JWT_SECRET);
      req.cookies = { token };

      const mockUser = {
        id: "user-123",
        name: "Active Student",
        email: "student@hosteldesk.dev",
        role: Role.STUDENT,
        trade: null,
        blockId: "block-a",
        isActive: true,
        currentRoomId: null,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      await requireAuth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual(mockUser);
    });

    it("supports Bearer authorization header", async () => {
      const token = jwt.sign({ userId: "user-123" }, env.JWT_SECRET);
      req.headers = { authorization: `Bearer ${token}` };

      const mockUser = {
        id: "user-123",
        name: "Bearer Student",
        email: "bearer@hosteldesk.dev",
        role: Role.STUDENT,
        trade: null,
        blockId: "block-a",
        isActive: true,
        currentRoomId: null,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      await requireAuth(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual(mockUser);
    });
  });

  describe("requireRole", () => {
    it("returns 401 if req.user is missing", () => {
      const guard = requireRole(Role.ADMIN);
      expect(() => guard(req as Request, res as Response, next)).toThrowError();
    });

    it("returns 403 when user does not have the required role", () => {
      req.user = {
        id: "student-1",
        name: "Student",
        email: "s@hosteldesk.dev",
        role: Role.STUDENT,
        isActive: true,
      };

      const guard = requireRole(Role.ADMIN, Role.WARDEN);
      expect(() => guard(req as Request, res as Response, next)).toThrowError(AppError);
      try {
        guard(req as Request, res as Response, next);
      } catch (e: any) {
        expect(e.statusCode).toBe(403);
        expect(e.code).toBe("FORBIDDEN");
      }
    });

    it("calls next() when user has the required role", () => {
      req.user = {
        id: "admin-1",
        name: "Admin",
        email: "admin@hosteldesk.dev",
        role: Role.ADMIN,
        isActive: true,
      };

      const guard = requireRole(Role.ADMIN);
      guard(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
