import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateBlendedEstimate, getDurationEstimate } from "../src/modules/scheduling/estimator";
import { prisma } from "../src/lib/prisma";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    category: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

describe("Duration Estimator (Pure Function)", () => {
  it("returns default 40 when n = 0", () => {
    const result = calculateBlendedEstimate({
      defaultDuration: 40,
      n: 0,
      observedMedian: null,
      observedP80: null,
      scope: "BLOCK",
    });

    expect(result.p50Minutes).toBe(40);
    expect(result.p80Minutes).toBe(60); // 40 * 1.5
    expect(result.n).toBe(0);
    expect(result.observedMedian).toBeNull();
    expect(result.observedP80).toBeNull();
  });

  it("calculates exact p50 = 55 when default is 40, n = 5 and observed median is 70", () => {
    // p50 = (5 * 40 + 5 * 70) / (5 + 5) = (200 + 350) / 10 = 55
    const result = calculateBlendedEstimate({
      defaultDuration: 40,
      n: 5,
      observedMedian: 70,
      observedP80: 90,
      scope: "BLOCK",
    });

    expect(result.p50Minutes).toBe(55);
    // p80 = (5 * 40 * 1.5 + 5 * 90) / 10 = (300 + 450) / 10 = 75
    expect(result.p80Minutes).toBe(75);
    expect(result.n).toBe(5);
  });

  it("calculates exact p50 = 67 when default is 40, n = 45 and observed median is 70", () => {
    // p50 = (5 * 40 + 45 * 70) / (5 + 45) = (200 + 3150) / 50 = 3350 / 50 = 67
    const result = calculateBlendedEstimate({
      defaultDuration: 40,
      n: 45,
      observedMedian: 70,
      observedP80: 85,
      scope: "BLOCK",
    });

    expect(result.p50Minutes).toBe(67);
    expect(result.n).toBe(45);
  });

  it("enforces that p80 is never below p50", () => {
    // If observed p80 is anomalous or lower than p50
    const result = calculateBlendedEstimate({
      defaultDuration: 50,
      n: 10,
      observedMedian: 60,
      observedP80: 40, // lower than median
      scope: "HOSTEL",
    });

    expect(result.p80Minutes).toBeGreaterThanOrEqual(result.p50Minutes);
  });
});

describe("Duration Estimator (DB Wrapper & Scope Fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses BLOCK scope when block has >= 5 matching tickets", async () => {
    vi.mocked(prisma.category.findUnique).mockResolvedValue({
      id: "cat-1",
      defaultDurationMin: 40,
    } as any);

    // Block query returns count = 7
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { count: 7, median: 65, p80: 85 },
    ]);

    const result = await getDurationEstimate("cat-1", "block-a");

    expect(result.scope).toBe("BLOCK");
    expect(result.n).toBe(7);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("falls back to HOSTEL scope when block has fewer than 5 tickets", async () => {
    vi.mocked(prisma.category.findUnique).mockResolvedValue({
      id: "cat-1",
      defaultDurationMin: 40,
    } as any);

    // 1st call for block returns count = 3 (< 5)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ count: 3, median: 70, p80: 90 }])
      // 2nd call for hostel returns count = 12
      .mockResolvedValueOnce([{ count: 12, median: 68, p80: 88 }]);

    const result = await getDurationEstimate("cat-1", "block-a");

    expect(result.scope).toBe("HOSTEL");
    expect(result.n).toBe(12);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
