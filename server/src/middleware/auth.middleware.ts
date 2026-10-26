import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { AuthenticatedUser } from "../types/express";
import { OccupancyService } from "../modules/occupancy/occupancy.service";

interface JwtPayload {
  userId: string;
}

export const requireAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token =
      req.cookies?.token ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.substring(7)
        : null);

    if (!token) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    } catch {
      throw new AppError(401, "UNAUTHORIZED", "Invalid or expired token");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        trade: true,
        blockId: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, "UNAUTHORIZED", "User not found or inactive");
    }

    let currentRoomId: string | null = null;
    if (user.role === Role.STUDENT) {
      currentRoomId = await OccupancyService.getCurrentRoomId(user.id);
    }

    req.user = {
      ...(user as AuthenticatedUser),
      currentRoomId,
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (...roles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    if (!roles.includes(req.user.role)) {
      throw new AppError(403, "FORBIDDEN", "Forbidden: insufficient permissions");
    }

    next();
  };
};
