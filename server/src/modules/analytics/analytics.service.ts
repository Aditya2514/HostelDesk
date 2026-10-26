import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { AuthenticatedUser } from "../../types/express";
import {
  calculateReliabilityScore,
  computeTradeLockedVisitMedians,
  isLockedVisitOutlier,
  resolveAnalyticsScope,
} from "./score";

/**
 * Definition of Prediction Error (per Section 5.10 & Phase 6 specs):
 * Prediction error for a resolved ticket = |predictedP50At of the latest prediction created
 * at or before startedAt - resolvedAt| in minutes. Tickets with no such prediction are skipped.
 */
export const PREDICTION_ERROR_DEFINITION =
  "|predictedP50At of latest prediction created at or before startedAt - resolvedAt| in minutes";

export class AnalyticsService {
  /**
   * 1. GET /api/analytics/overview
   * Open tickets by status & category, deadline breach rate, avg resolution time per category, escalations by level
   */
  static async getOverview(user: AuthenticatedUser, days: number = 30, requestedBlockId?: string) {
    const scope = resolveAnalyticsScope(user, requestedBlockId);
    const now = clock.now();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const blockFilter = scope.blockId ? Prisma.sql`AND t."blockId" = ${scope.blockId}` : Prisma.empty;
    const ticketBlockFilter = scope.blockId ? { blockId: scope.blockId } : {};

    // 1. Open tickets by status
    const OPEN_STATUSES = [
      "RAISED",
      "ASSIGNED",
      "IN_PROGRESS",
      "AWAITING_ACCESS",
      "ON_HOLD",
      "REOPENED",
    ] as const;

    const openByStatusRaw = await prisma.ticket.groupBy({
      by: ["status"],
      where: {
        status: { in: [...OPEN_STATUSES] },
        ...ticketBlockFilter,
      },
      _count: { id: true },
    });

    const openTicketsByStatus: Record<string, number> = {};
    for (const s of OPEN_STATUSES) {
      openTicketsByStatus[s] = 0;
    }
    let totalOpenCount = 0;
    for (const item of openByStatusRaw) {
      openTicketsByStatus[item.status] = item._count.id;
      totalOpenCount += item._count.id;
    }

    // 2. Open tickets by category
    const openByCategoryRaw = await prisma.$queryRaw<Array<{
      categoryId: string;
      categoryName: string;
      trade: string;
      count: number;
    }>>`
      SELECT
        c.id AS "categoryId",
        c.name AS "categoryName",
        c.trade,
        COUNT(t.id)::int AS "count"
      FROM tickets t
      JOIN categories c ON c.id = t."categoryId"
      WHERE t.status IN ('RAISED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_ACCESS', 'ON_HOLD', 'REOPENED')
        ${blockFilter}
      GROUP BY c.id, c.name, c.trade
      ORDER BY "count" DESC
    `;

    // 3. Deadline breach rate
    // Numerator: (tickets closed in the window with resolvedAt > dueAt) + (open tickets past dueAt)
    // Denominator: (tickets closed in the window) + (open tickets)
    const breachStats = await prisma.$queryRaw<Array<{
      closedInWindow: number;
      closedBreached: number;
      openPastDue: number;
    }>>`
      SELECT
        COUNT(CASE WHEN t."resolvedAt" >= ${windowStart} AND t."resolvedAt" <= ${now} THEN 1 END)::int AS "closedInWindow",
        COUNT(CASE WHEN t."resolvedAt" >= ${windowStart} AND t."resolvedAt" <= ${now} AND t."resolvedAt" > t."dueAt" THEN 1 END)::int AS "closedBreached",
        COUNT(CASE WHEN t.status IN ('RAISED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_ACCESS', 'ON_HOLD', 'REOPENED') AND t."dueAt" < ${now} THEN 1 END)::int AS "openPastDue"
      FROM tickets t
      WHERE 1=1 ${blockFilter}
    `;

    const closedInWindow = breachStats[0]?.closedInWindow ?? 0;
    const closedBreached = breachStats[0]?.closedBreached ?? 0;
    const openPastDue = breachStats[0]?.openPastDue ?? 0;

    const totalEvaluated = closedInWindow + totalOpenCount;
    const totalBreached = closedBreached + openPastDue;
    const deadlineBreachRate = totalEvaluated > 0 ? totalBreached / totalEvaluated : 0;
    const deadlineBreachPercentage = Math.round(deadlineBreachRate * 1000) / 10;

    // 4. Average resolution time per category in hours (resolvedAt - createdAt - totalPausedMinutes)
    const avgResolutionTime = await prisma.$queryRaw<Array<{
      categoryId: string;
      categoryName: string;
      trade: string;
      resolvedCount: number;
      avgHours: number | null;
    }>>`
      SELECT
        c.id AS "categoryId",
        c.name AS "categoryName",
        c.trade,
        COUNT(t.id)::int AS "resolvedCount",
        ROUND(AVG(
          GREATEST(0, EXTRACT(EPOCH FROM (t."resolvedAt" - t."createdAt")) / 3600.0 - (COALESCE(t."totalPausedMinutes", 0) / 60.0))
        )::numeric, 1) AS "avgHours"
      FROM tickets t
      JOIN categories c ON c.id = t."categoryId"
      WHERE t."resolvedAt" >= ${windowStart} AND t."resolvedAt" <= ${now}
        ${blockFilter}
      GROUP BY c.id, c.name, c.trade
      ORDER BY "avgHours" DESC NULLS LAST
    `;

    // 5. Counts of escalations by level
    const escalationsRaw = await prisma.ticket.groupBy({
      by: ["escalationLevel"],
      where: {
        ...ticketBlockFilter,
      },
      _count: { id: true },
    });

    const escalationsByLevel: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    for (const esc of escalationsRaw) {
      escalationsByLevel[esc.escalationLevel] = esc._count.id;
    }

    // 6. Synthetic share
    const synthStats = await prisma.$queryRaw<Array<{
      totalTickets: number;
      syntheticTickets: number;
    }>>`
      SELECT
        COUNT(t.id)::int AS "totalTickets",
        COUNT(CASE WHEN t."isSynthetic" = true THEN 1 END)::int AS "syntheticTickets"
      FROM tickets t
      WHERE t."createdAt" >= ${windowStart} AND t."createdAt" <= ${now}
        ${blockFilter}
    `;

    const totalWindowTickets = synthStats[0]?.totalTickets ?? 0;
    const syntheticWindowTickets = synthStats[0]?.syntheticTickets ?? 0;
    const syntheticShare = totalWindowTickets > 0
      ? Math.round((syntheticWindowTickets / totalWindowTickets) * 1000) / 1000
      : 0;

    const blocks = await prisma.block.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return {
      windowDays: days,
      scope: {
        blockId: scope.blockId ?? null,
      },
      blocks,
      openTicketsCount: totalOpenCount,
      openTicketsByStatus,
      openTicketsByCategory: openByCategoryRaw,
      deadlineBreachRate: Math.round(deadlineBreachRate * 1000) / 1000,
      deadlineBreachPercentage,
      breachStats: {
        totalEvaluated,
        totalBreached,
        closedInWindow,
        closedBreached,
        openPastDue,
      },
      avgResolutionTimeByCategory: avgResolutionTime.map((r) => ({
        ...r,
        avgHours: r.avgHours !== null ? Number(r.avgHours) : 0,
      })),
      escalationsByLevel,
      syntheticShare,
      meta: {
        predictionErrorDefinition: PREDICTION_ERROR_DEFINITION,
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
      },
    };
  }

  /**
   * 2. GET /api/analytics/staff
   * Per staff member: jobs resolved in window, % verified by CODE, reopen rate, SLA-met rate,
   * median prediction error (min), locked-visit rate, upheld false-lock disputes, reliability score & outlier flag
   */
  static async getStaff(user: AuthenticatedUser, days: number = 30, requestedBlockId?: string) {
    const scope = resolveAnalyticsScope(user, requestedBlockId);
    const now = clock.now();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const blockFilter = scope.blockId ? Prisma.sql`AND t."blockId" = ${scope.blockId}` : Prisma.empty;

    // Single aggregate query for all staff metrics using lateral join for latest prediction
    const staffRows = await prisma.$queryRaw<Array<{
      staffId: string;
      name: string;
      email: string;
      trade: string;
      resolvedCount: number;
      codeVerifiedCount: number;
      slaMetCount: number;
      reopenedTicketsCount: number;
      totalLockedVisits: number;
      medianPredictionErrorMinutes: number | null;
      upheldFalseLockDisputes: number;
    }>>`
      WITH staff_predictions AS (
        SELECT
          t."assignedToId" AS "staffId",
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(EXTRACT(EPOCH FROM (p."predictedP50At" - t."resolvedAt")) / 60)) AS "medianError"
        FROM tickets t
        JOIN LATERAL (
          SELECT p."predictedP50At"
          FROM ticket_predictions p
          WHERE p."ticketId" = t.id
            AND p."createdAt" <= COALESCE(t."startedAt", t."resolvedAt")
          ORDER BY p."createdAt" DESC
          LIMIT 1
        ) p ON true
        WHERE t."resolvedAt" >= ${windowStart} AND t."resolvedAt" <= ${now}
          AND t."assignedToId" IS NOT NULL
          ${blockFilter}
        GROUP BY t."assignedToId"
      ),
      staff_tickets AS (
        SELECT
          t."assignedToId" AS "staffId",
          COUNT(t.id)::int AS "resolvedCount",
          COUNT(CASE WHEN t."resolutionMethod" = 'CODE' THEN 1 END)::int AS "codeVerifiedCount",
          COUNT(CASE WHEN t."resolvedAt" <= t."dueAt" THEN 1 END)::int AS "slaMetCount",
          COUNT(CASE WHEN t."reopenCount" > 0 THEN 1 END)::int AS "reopenedTicketsCount",
          COALESCE(SUM(t."lockedVisitCount"), 0)::int AS "totalLockedVisits"
        FROM tickets t
        WHERE t."resolvedAt" >= ${windowStart} AND t."resolvedAt" <= ${now}
          AND t."assignedToId" IS NOT NULL
          ${blockFilter}
        GROUP BY t."assignedToId"
      ),
      staff_disputes AS (
        SELECT
          t."assignedToId" AS "staffId",
          COUNT(d.id)::int AS "upheldFalseLockDisputes"
        FROM disputes d
        JOIN tickets t ON t.id = d."ticketId"
        WHERE d.type = 'LOCKED_CLAIM_FALSE'
          AND d.status = 'UPHELD'
          AND d."createdAt" >= ${windowStart}
          AND t."assignedToId" IS NOT NULL
          ${blockFilter}
        GROUP BY t."assignedToId"
      )
      SELECT
        u.id AS "staffId",
        u.name,
        u.email,
        u.trade,
        COALESCE(st."resolvedCount", 0)::int AS "resolvedCount",
        COALESCE(st."codeVerifiedCount", 0)::int AS "codeVerifiedCount",
        COALESCE(st."slaMetCount", 0)::int AS "slaMetCount",
        COALESCE(st."reopenedTicketsCount", 0)::int AS "reopenedTicketsCount",
        COALESCE(st."totalLockedVisits", 0)::int AS "totalLockedVisits",
        sp."medianError" AS "medianPredictionErrorMinutes",
        COALESCE(sd."upheldFalseLockDisputes", 0)::int AS "upheldFalseLockDisputes"
      FROM users u
      LEFT JOIN staff_tickets st ON st."staffId" = u.id
      LEFT JOIN staff_predictions sp ON sp."staffId" = u.id
      LEFT JOIN staff_disputes sd ON sd."staffId" = u.id
      WHERE u.role = 'STAFF' AND u."isActive" = true
      ORDER BY u.trade ASC, u.name ASC
    `;

    // Process staff items and compute rates
    const rawStaffList = staffRows.map((r) => {
      const resolvedCount = r.resolvedCount;
      const codeVerifiedRate = resolvedCount > 0 ? r.codeVerifiedCount / resolvedCount : 0;
      const slaMetRate = resolvedCount > 0 ? r.slaMetCount / resolvedCount : 0;
      const reopenRate = resolvedCount > 0 ? r.reopenedTicketsCount / resolvedCount : 0;
      const lockedVisitRate = resolvedCount > 0 ? r.totalLockedVisits / resolvedCount : 0;

      const scoreResult = calculateReliabilityScore({
        resolvedCount,
        codeVerifiedCount: r.codeVerifiedCount,
        slaMetCount: r.slaMetCount,
        reopenedTicketsCount: r.reopenedTicketsCount,
        medianPredictionErrorMinutes:
          r.medianPredictionErrorMinutes !== null ? Number(r.medianPredictionErrorMinutes) : null,
      });

      return {
        staffId: r.staffId,
        name: r.name,
        email: r.email,
        trade: r.trade,
        resolvedCount,
        codeVerifiedCount: r.codeVerifiedCount,
        codeVerifiedRate: Math.round(codeVerifiedRate * 1000) / 1000,
        codeVerifiedPercentage: Math.round(codeVerifiedRate * 1000) / 10,
        slaMetCount: r.slaMetCount,
        slaMetRate: Math.round(slaMetRate * 1000) / 1000,
        slaMetPercentage: Math.round(slaMetRate * 1000) / 10,
        reopenCount: r.reopenedTicketsCount,
        reopenRate: Math.round(reopenRate * 1000) / 1000,
        reopenPercentage: Math.round(reopenRate * 1000) / 10,
        totalLockedVisits: r.totalLockedVisits,
        lockedVisitRate: Math.round(lockedVisitRate * 1000) / 1000,
        upheldFalseLockDisputes: r.upheldFalseLockDisputes,
        medianPredictionErrorMinutes:
          r.medianPredictionErrorMinutes !== null
            ? Math.round(Number(r.medianPredictionErrorMinutes) * 10) / 10
            : null,
        reliabilityScore: scoreResult.score,
        reliabilityReason: scoreResult.reason,
        reliabilityComponents: scoreResult.components,
      };
    });

    // Compute trade medians for locked-visit outlier detection
    const tradeMedians = computeTradeLockedVisitMedians(
      rawStaffList.map((s) => ({ trade: s.trade, lockedVisitRate: s.lockedVisitRate }))
    );

    const staffWithOutliers = rawStaffList.map((s) => ({
      ...s,
      isLockedVisitOutlier: isLockedVisitOutlier(
        {
          trade: s.trade,
          lockedVisitRate: s.lockedVisitRate,
          totalLockedVisits: s.totalLockedVisits,
        },
        tradeMedians
      ),
    }));

    return {
      windowDays: days,
      scope: {
        blockId: scope.blockId ?? null,
      },
      tradeMedians,
      staff: staffWithOutliers,
      meta: {
        predictionErrorDefinition: PREDICTION_ERROR_DEFINITION,
        reliabilityFormula:
          "100 * (0.35 * codeVerifiedRate + 0.30 * slaMetRate + 0.20 * (1 - reopenRate) + 0.15 * accuracyScore)",
        outlierFormula:
          "lockedVisitRate > 2 * tradeMedianRate AND totalLockedVisits >= 3",
      },
    };
  }

  /**
   * 3. GET /api/analytics/prediction-trend
   * Weekly average absolute prediction error (min) over the window, with ticket counts per week
   */
  static async getPredictionTrend(user: AuthenticatedUser, days: number = 30, requestedBlockId?: string) {
    const scope = resolveAnalyticsScope(user, requestedBlockId);
    const now = clock.now();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const blockFilter = scope.blockId ? Prisma.sql`AND t."blockId" = ${scope.blockId}` : Prisma.empty;

    // Aggregate by week
    const weeksRaw = await prisma.$queryRaw<Array<{
      weekStart: Date;
      ticketCount: number;
      avgErrorMinutes: number | null;
      syntheticCount: number;
    }>>`
      SELECT
        date_trunc('week', t."resolvedAt") AS "weekStart",
        COUNT(t.id)::int AS "ticketCount",
        ROUND(AVG(ABS(EXTRACT(EPOCH FROM (p."predictedP50At" - t."resolvedAt")) / 60))::numeric, 1) AS "avgErrorMinutes",
        COUNT(CASE WHEN t."isSynthetic" = true THEN 1 END)::int AS "syntheticCount"
      FROM tickets t
      JOIN LATERAL (
        SELECT p."predictedP50At"
        FROM ticket_predictions p
        WHERE p."ticketId" = t.id
          AND p."createdAt" <= COALESCE(t."startedAt", t."resolvedAt")
        ORDER BY p."createdAt" DESC
        LIMIT 1
      ) p ON true
      WHERE t."resolvedAt" >= ${windowStart} AND t."resolvedAt" <= ${now}
        ${blockFilter}
      GROUP BY date_trunc('week', t."resolvedAt")
      ORDER BY "weekStart" ASC
    `;

    let totalTickets = 0;
    let totalSynthetic = 0;

    const weeks = weeksRaw.map((w, index) => {
      totalTickets += w.ticketCount;
      totalSynthetic += w.syntheticCount;
      const weekStartDate = new Date(w.weekStart);
      return {
        weekIndex: index + 1,
        weekStart: weekStartDate.toISOString().split("T")[0],
        weekLabel: `W${index + 1} (${weekStartDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`,
        ticketCount: w.ticketCount,
        avgErrorMinutes: w.avgErrorMinutes !== null ? Number(w.avgErrorMinutes) : 0,
        syntheticCount: w.syntheticCount,
      };
    });

    const syntheticShare = totalTickets > 0
      ? Math.round((totalSynthetic / totalTickets) * 1000) / 1000
      : 0;

    return {
      windowDays: days,
      scope: {
        blockId: scope.blockId ?? null,
      },
      weeks,
      totalTickets,
      syntheticShare,
      isSyntheticDataIncluded: totalSynthetic > 0,
      meta: {
        predictionErrorDefinition: PREDICTION_ERROR_DEFINITION,
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
      },
    };
  }

  /**
   * 4. GET /api/analytics/repeat-rooms
   * Rooms with >= 3 tickets of the same trade in the window: room, block, trade, count, latest ticket date
   */
  static async getRepeatRooms(user: AuthenticatedUser, days: number = 30, requestedBlockId?: string) {
    const scope = resolveAnalyticsScope(user, requestedBlockId);
    const now = clock.now();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const blockFilter = scope.blockId ? Prisma.sql`AND t."blockId" = ${scope.blockId}` : Prisma.empty;

    const repeatRooms = await prisma.$queryRaw<Array<{
      roomId: string;
      roomNumber: string;
      floor: number;
      blockId: string;
      blockName: string;
      trade: string;
      count: number;
      latestTicketDate: Date;
    }>>`
      SELECT
        r.id AS "roomId",
        r.number AS "roomNumber",
        r.floor,
        b.id AS "blockId",
        b.name AS "blockName",
        c.trade,
        COUNT(t.id)::int AS "count",
        MAX(t."createdAt") AS "latestTicketDate"
      FROM tickets t
      JOIN rooms r ON r.id = t."roomId"
      JOIN blocks b ON b.id = r."blockId"
      JOIN categories c ON c.id = t."categoryId"
      WHERE t."createdAt" >= ${windowStart} AND t."createdAt" <= ${now}
        ${blockFilter}
      GROUP BY r.id, r.number, r.floor, b.id, b.name, c.trade
      HAVING COUNT(t.id) >= 3
      ORDER BY "count" DESC, "latestTicketDate" DESC
    `;

    return {
      windowDays: days,
      scope: {
        blockId: scope.blockId ?? null,
      },
      repeatRooms: repeatRooms.map((r) => ({
        roomId: r.roomId,
        roomNumber: r.roomNumber,
        floor: r.floor,
        blockId: r.blockId,
        blockName: r.blockName,
        trade: r.trade,
        count: r.count,
        latestTicketDate: r.latestTicketDate.toISOString(),
      })),
      totalRepeatIssues: repeatRooms.length,
      meta: {
        threshold: ">= 3 tickets of same trade in window",
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
      },
    };
  }
}
