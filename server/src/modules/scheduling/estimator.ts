import { PrismaClient, Prisma } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma";

export interface EstimateParams {
  defaultDuration: number;
  n: number;
  observedMedian: number | null;
  observedP80: number | null;
  scope: "BLOCK" | "HOSTEL";
}

export interface EstimateResult {
  p50Minutes: number;
  p80Minutes: number;
  n: number;
  observedMedian: number | null;
  observedP80: number | null;
  scope: "BLOCK" | "HOSTEL";
  defaultDuration: number;
}

/**
 * Pure calculation function for blended duration estimation.
 * 
 * Formula:
 *   p50Estimate = (k * defaultDuration + n * observedMedian) / (k + n)
 *   p80Estimate = (k * defaultDuration * 1.5 + n * observedP80) / (k + n)
 *   where k = 5, and p80Estimate >= p50Estimate is enforced.
 */
export function calculateBlendedEstimate(params: EstimateParams): EstimateResult {
  const k = 5;
  const { defaultDuration, n, observedMedian, observedP80, scope } = params;

  if (n <= 0 || observedMedian === null || observedP80 === null) {
    const p50 = Math.round(defaultDuration);
    const p80 = Math.round(defaultDuration * 1.5);
    return {
      p50Minutes: p50,
      p80Minutes: Math.max(p80, p50),
      n: 0,
      observedMedian: null,
      observedP80: null,
      scope,
      defaultDuration,
    };
  }

  const p50 = Math.round((k * defaultDuration + n * observedMedian) / (k + n));
  const rawP80 = Math.round((k * defaultDuration * 1.5 + n * observedP80) / (k + n));
  const p80 = Math.max(rawP80, p50);

  return {
    p50Minutes: p50,
    p80Minutes: p80,
    n,
    observedMedian: Math.round(observedMedian * 10) / 10,
    observedP80: Math.round(observedP80 * 10) / 10,
    scope,
    defaultDuration,
  };
}

interface RawPercentileRow {
  count: number;
  median: number | null;
  p80: number | null;
}

/**
 * DB wrapper to estimate job duration for a category and optional block.
 * Uses PostgreSQL percentile_cont via $queryRaw for trustworthy tickets:
 *   - actualWorkMinutes IS NOT NULL and > 0
 *   - resolutionMethod = 'CODE' OR (status = 'CLOSED' AND closeReason = 'CONFIRMED')
 * 
 * Fallback rule:
 *   Tries block-level first. If block has < 5 trustworthy tickets, falls back to HOSTEL scope.
 */
export async function getDurationEstimate(
  categoryId: string,
  blockId?: string | null,
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma
): Promise<EstimateResult> {
  const category = await client.category.findUnique({
    where: { id: categoryId },
    select: { defaultDurationMin: true },
  });

  const defaultDuration = category?.defaultDurationMin ?? 45;

  // 1. Try block-scoped query if blockId is provided
  if (blockId) {
    const blockRows = await client.$queryRaw<RawPercentileRow[]>`
      SELECT
        COUNT(*)::int AS count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "actualWorkMinutes") AS median,
        PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY "actualWorkMinutes") AS p80
      FROM tickets
      WHERE "categoryId" = ${categoryId}
        AND "blockId" = ${blockId}
        AND "actualWorkMinutes" IS NOT NULL
        AND "actualWorkMinutes" > 0
        AND (
          "resolutionMethod" = 'CODE'
          OR ("status" = 'CLOSED' AND "closeReason" = 'CONFIRMED')
        )
    `;

    const count = blockRows[0]?.count ?? 0;
    if (count >= 5 && blockRows[0]?.median !== null) {
      return calculateBlendedEstimate({
        defaultDuration,
        n: count,
        observedMedian: Number(blockRows[0].median),
        observedP80: Number(blockRows[0].p80 ?? blockRows[0].median),
        scope: "BLOCK",
      });
    }
  }

  // 2. Fall back to hostel-wide query
  const hostelRows = await client.$queryRaw<RawPercentileRow[]>`
    SELECT
      COUNT(*)::int AS count,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "actualWorkMinutes") AS median,
      PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY "actualWorkMinutes") AS p80
    FROM tickets
    WHERE "categoryId" = ${categoryId}
      AND "actualWorkMinutes" IS NOT NULL
      AND "actualWorkMinutes" > 0
      AND (
        "resolutionMethod" = 'CODE'
        OR ("status" = 'CLOSED' AND "closeReason" = 'CONFIRMED')
      )
  `;

  const hostelCount = hostelRows[0]?.count ?? 0;
  return calculateBlendedEstimate({
    defaultDuration,
    n: hostelCount,
    observedMedian: hostelRows[0]?.median !== null ? Number(hostelRows[0].median) : null,
    observedP80: hostelRows[0]?.p80 !== null ? Number(hostelRows[0].p80) : null,
    scope: "HOSTEL",
  });
}
