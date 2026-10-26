import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { OccupancyService } from "../occupancy/occupancy.service";

export class AuthService {
  static async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        block: true,
      },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const token = jwt.sign(
      {
        userId: user.id,
      },
      env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const currentRoom = await OccupancyService.getCurrentRoomDetails(user.id);

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        trade: user.trade,
        blockId: user.blockId,
        blockName: user.block?.name || null,
        currentRoom,
      },
    };
  }

  static async getCurrentUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        block: true,
      },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, "UNAUTHORIZED", "User not found or inactive");
    }

    const currentRoom = await OccupancyService.getCurrentRoomDetails(user.id);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      trade: user.trade,
      blockId: user.blockId,
      blockName: user.block?.name || null,
      currentRoom,
    };
  }
}
