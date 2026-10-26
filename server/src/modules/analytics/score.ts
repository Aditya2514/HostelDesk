export interface ReliabilityScoreComponents {
  codeVerifiedRate: number;
  slaMetRate: number;
  reopenRate: number;
  accuracyScore: number;
  medianPredictionErrorMinutes: number | null;
}

export interface ReliabilityScoreResult {
  score: number | null;
  reason?: "INSUFFICIENT_DATA";
  components: ReliabilityScoreComponents;
}

/**
 * Pure function to calculate staff reliability score:
 *
 * score = 100 * ( 0.35 * codeVerifiedRate
 *               + 0.30 * slaMetRate
 *               + 0.20 * (1 - reopenRate)
 *               + 0.15 * accuracyScore )
 * accuracyScore = max(0, 1 - medianPredictionErrorMinutes / 60)
 *
 * Fewer than 5 resolved jobs in window -> score: null, reason: "INSUFFICIENT_DATA"
 */
export function calculateReliabilityScore(params: {
  resolvedCount: number;
  codeVerifiedCount: number;
  slaMetCount: number;
  reopenedTicketsCount: number;
  medianPredictionErrorMinutes: number | null;
}): ReliabilityScoreResult {
  const {
    resolvedCount,
    codeVerifiedCount,
    slaMetCount,
    reopenedTicketsCount,
    medianPredictionErrorMinutes,
  } = params;

  const codeVerifiedRate = resolvedCount > 0 ? codeVerifiedCount / resolvedCount : 0;
  const slaMetRate = resolvedCount > 0 ? slaMetCount / resolvedCount : 0;
  const reopenRate = resolvedCount > 0 ? Math.min(1, reopenedTicketsCount / resolvedCount) : 0;

  const accuracyScore =
    medianPredictionErrorMinutes !== null
      ? Math.max(0, 1 - medianPredictionErrorMinutes / 60)
      : 0;

  const components: ReliabilityScoreComponents = {
    codeVerifiedRate: Math.round(codeVerifiedRate * 1000) / 1000,
    slaMetRate: Math.round(slaMetRate * 1000) / 1000,
    reopenRate: Math.round(reopenRate * 1000) / 1000,
    accuracyScore: Math.round(accuracyScore * 1000) / 1000,
    medianPredictionErrorMinutes:
      medianPredictionErrorMinutes !== null
        ? Math.round(medianPredictionErrorMinutes * 10) / 10
        : null,
  };

  if (resolvedCount < 5) {
    return {
      score: null,
      reason: "INSUFFICIENT_DATA",
      components,
    };
  }

  const rawScore =
    100 *
    (0.35 * codeVerifiedRate +
      0.30 * slaMetRate +
      0.20 * (1 - reopenRate) +
      0.15 * accuracyScore);

  const score = Math.round(Math.max(0, Math.min(100, rawScore)) * 10) / 10;

  return {
    score,
    components,
  };
}

/**
 * Computes median locked-visit rate for each trade group.
 */
export function computeTradeLockedVisitMedians(
  staffList: Array<{ trade: string; lockedVisitRate: number }>
): Record<string, number> {
  const byTrade: Record<string, number[]> = {};
  for (const s of staffList) {
    if (!byTrade[s.trade]) byTrade[s.trade] = [];
    byTrade[s.trade].push(s.lockedVisitRate);
  }

  const medians: Record<string, number> = {};
  for (const trade of Object.keys(byTrade)) {
    const rates = [...byTrade[trade]].sort((a, b) => a - b);
    if (rates.length === 0) {
      medians[trade] = 0;
      continue;
    }
    const mid = Math.floor(rates.length / 2);
    if (rates.length % 2 === 0) {
      medians[trade] = (rates[mid - 1] + rates[mid]) / 2;
    } else {
      medians[trade] = rates[mid];
    }
  }

  return medians;
}

/**
 * Locked-visit outlier flag:
 * locked-visit rate > 2 * the median rate of staff in the same trade AND at least 3 locked visits.
 */
export function isLockedVisitOutlier(
  staff: { trade: string; lockedVisitRate: number; totalLockedVisits: number },
  tradeMedians: Record<string, number>
): boolean {
  const medianRate = tradeMedians[staff.trade] ?? 0;
  return staff.totalLockedVisits >= 3 && staff.lockedVisitRate > 2 * medianRate;
}

/**
 * Enforces scope based on user role:
 * - WARDEN: strictly restricted to their assigned blockId; ignores any requested blockId
 * - CHIEF_WARDEN / ADMIN: sees all blocks, or can optionally filter by requested blockId
 */
export function resolveAnalyticsScope(
  user: { role: string; blockId?: string | null },
  requestedBlockId?: string
): { blockId?: string } {
  if (user.role === "WARDEN") {
    return { blockId: user.blockId || undefined };
  }
  if (requestedBlockId) {
    return { blockId: requestedBlockId };
  }
  return {};
}
