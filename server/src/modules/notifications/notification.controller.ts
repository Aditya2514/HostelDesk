import { Request, Response, NextFunction } from "express";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/errors";
import { clock } from "../../lib/clock";

export class NotificationController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const skip = (page - 1) * limit;

      const [notifications, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip,
        }),
        prisma.notification.count({ where: { userId: user.id } }),
        prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      ]);

      res.status(200).json({
        notifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { id } = req.params;

      const notification = await prisma.notification.findUnique({
        where: { id },
      });

      if (!notification || notification.userId !== user.id) {
        throw new AppError(404, "NOT_FOUND", "Notification not found");
      }

      await prisma.notification.update({
        where: { id },
        data: { readAt: clock.now() },
      });

      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  static async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;

      await prisma.notification.updateMany({
        where: {
          userId: user.id,
          readAt: null,
        },
        data: {
          readAt: clock.now(),
        },
      });

      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}
