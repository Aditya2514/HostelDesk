import { Prisma } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";

export interface LogAdminActionParams {
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string;
  payload?: any;
}

export class AuditService {
  /**
   * Logs an admin mutation into admin_audit_logs table.
   * Runs inside the provided transaction client to ensure atomic logging with mutations.
   */
  static async logAction(
    params: LogAdminActionParams,
    tx: Prisma.TransactionClient = defaultPrisma
  ) {
    return tx.adminAuditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        payload: params.payload !== undefined ? (params.payload as Prisma.InputJsonValue) : Prisma.JsonNull,
        createdAt: clock.now(),
      },
    });
  }

  /**
   * Retrieves paginated audit logs, newest first.
   */
  static async getAuditLogs(page: number = 1, limit: number = 20) {
    const validLimit = Math.min(100, Math.max(1, limit));
    const validPage = Math.max(1, page);
    const skip = (validPage - 1) * validLimit;

    const [total, logs] = await Promise.all([
      defaultPrisma.adminAuditLog.count(),
      defaultPrisma.adminAuditLog.findMany({
        skip,
        take: validLimit,
        orderBy: { createdAt: "desc" },
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      }),
    ]);

    return {
      logs,
      pagination: {
        page: validPage,
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit),
      },
    };
  }
}
