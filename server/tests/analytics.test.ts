import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import {
  calculateReliabilityScore,
  computeTradeLockedVisitMedians,
  isLockedVisitOutlier,
  resolveAnalyticsScope,
} from "../src/modules/analytics/score";

describe("Analytics Module — Reliability Score, Outlier Flag & Scope Filter", () => {
  describe("Reliability Score Formula", () => {
    it("matches exact hand-computed Example 1 (84.3)", () => {
      // Inputs:
      // resolvedCount = 10
      // codeVerifiedCount = 8 (rate = 0.8)
      // slaMetCount = 9 (rate = 0.9)
      // reopenedTicketsCount = 1 (rate = 0.1)
      // medianPredictionErrorMinutes = 15 -> accuracyScore = 1 - 15/60 = 0.75
      //
      // score = 100 * (0.35 * 0.8 + 0.30 * 0.9 + 0.20 * 0.9 + 0.15 * 0.75)
      //       = 100 * (0.28 + 0.27 + 0.18 + 0.1125) = 84.25 -> rounded to 84.3
      const result = calculateReliabilityScore({
        resolvedCount: 10,
        codeVerifiedCount: 8,
        slaMetCount: 9,
        reopenedTicketsCount: 1,
        medianPredictionErrorMinutes: 15,
      });

      expect(result.score).toBe(84.3);
      expect(result.reason).toBeUndefined();
      expect(result.components.codeVerifiedRate).toBe(0.8);
      expect(result.components.slaMetRate).toBe(0.9);
      expect(result.components.reopenRate).toBe(0.1);
      expect(result.components.accuracyScore).toBe(0.75);
      expect(result.components.medianPredictionErrorMinutes).toBe(15);
    });

    it("matches exact hand-computed Example 2 — Perfect Score (100.0)", () => {
      // Inputs:
      // resolvedCount = 20
      // codeVerifiedCount = 20 (rate = 1.0)
      // slaMetCount = 20 (rate = 1.0)
      // reopenedTicketsCount = 0 (rate = 0.0)
      // medianPredictionErrorMinutes = 0 -> accuracyScore = 1.0
      //
      // score = 100 * (0.35 * 1.0 + 0.30 * 1.0 + 0.20 * 1.0 + 0.15 * 1.0) = 100.0
      const result = calculateReliabilityScore({
        resolvedCount: 20,
        codeVerifiedCount: 20,
        slaMetCount: 20,
        reopenedTicketsCount: 0,
        medianPredictionErrorMinutes: 0,
      });

      expect(result.score).toBe(100);
      expect(result.components.accuracyScore).toBe(1.0);
    });

    it("clamps accuracyScore to 0 when median error exceeds 60 minutes", () => {
      const result = calculateReliabilityScore({
        resolvedCount: 10,
        codeVerifiedCount: 10,
        slaMetCount: 10,
        reopenedTicketsCount: 0,
        medianPredictionErrorMinutes: 120, // > 60 min
      });

      expect(result.components.accuracyScore).toBe(0);
      // score = 100 * (0.35 + 0.30 + 0.20 + 0) = 85
      expect(result.score).toBe(85);
    });

    it("returns null score and INSUFFICIENT_DATA when resolvedCount < 5", () => {
      const result = calculateReliabilityScore({
        resolvedCount: 4,
        codeVerifiedCount: 4,
        slaMetCount: 4,
        reopenedTicketsCount: 0,
        medianPredictionErrorMinutes: 10,
      });

      expect(result.score).toBeNull();
      expect(result.reason).toBe("INSUFFICIENT_DATA");
    });
  });

  describe("Locked-Visit Outlier Flag", () => {
    it("computes trade medians and correctly flags outliers", () => {
      const staffList = [
        { trade: "ELECTRICIAN", lockedVisitRate: 0.05 },
        { trade: "ELECTRICIAN", lockedVisitRate: 0.10 },
        { trade: "ELECTRICIAN", lockedVisitRate: 0.30 },
      ];

      const medians = computeTradeLockedVisitMedians(staffList);
      expect(medians["ELECTRICIAN"]).toBe(0.10);

      // Staff C: rate 0.30 > 2 * 0.10 AND locked visits 5 >= 3 -> Outlier
      expect(
        isLockedVisitOutlier(
          { trade: "ELECTRICIAN", lockedVisitRate: 0.30, totalLockedVisits: 5 },
          medians
        )
      ).toBe(true);

      // Staff with high rate but < 3 visits is NOT an outlier
      expect(
        isLockedVisitOutlier(
          { trade: "ELECTRICIAN", lockedVisitRate: 0.30, totalLockedVisits: 2 },
          medians
        )
      ).toBe(false);

      // Staff with >= 3 visits but rate <= 2 * median is NOT an outlier
      expect(
        isLockedVisitOutlier(
          { trade: "ELECTRICIAN", lockedVisitRate: 0.15, totalLockedVisits: 4 },
          medians
        )
      ).toBe(false);
    });
  });

  describe("Scope Filter", () => {
    it("strictly prevents a WARDEN from accessing another block even if ?blockId= is passed", () => {
      const wardenUser = {
        role: "WARDEN",
        blockId: "block-a-uuid",
      };

      // Warden tries to request block B
      const scope = resolveAnalyticsScope(wardenUser, "block-b-uuid");
      expect(scope.blockId).toBe("block-a-uuid");

      // Warden makes request with no blockId
      const scopeDefault = resolveAnalyticsScope(wardenUser);
      expect(scopeDefault.blockId).toBe("block-a-uuid");
    });

    it("allows CHIEF_WARDEN and ADMIN to view all blocks or filter by requested blockId", () => {
      const chiefWarden = { role: "CHIEF_WARDEN" };
      const admin = { role: "ADMIN" };

      // With blockId
      expect(resolveAnalyticsScope(chiefWarden, "block-b-uuid")).toEqual({
        blockId: "block-b-uuid",
      });
      expect(resolveAnalyticsScope(admin, "block-b-uuid")).toEqual({
        blockId: "block-b-uuid",
      });

      // Without blockId (all blocks)
      expect(resolveAnalyticsScope(chiefWarden)).toEqual({});
      expect(resolveAnalyticsScope(admin)).toEqual({});
    });
  });

  describe("Role Authorization", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(app).get("/api/analytics/overview");
      expect(res.status).toBe(401);
    });
  });
});
