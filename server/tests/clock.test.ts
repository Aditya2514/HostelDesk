import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clock } from "../src/lib/clock";

describe("ClockService", () => {
  beforeEach(() => {
    clock.reset();
    clock.setDemoModeForTesting(true);
  });

  afterEach(() => {
    clock.reset();
    clock.setDemoModeForTesting(null);
  });

  it("returns current time when offset is 0", () => {
    const realNow = Date.now();
    const clockNow = clock.now().getTime();
    expect(Math.abs(clockNow - realNow)).toBeLessThan(100);
  });

  it("advances time when demo mode is enabled", () => {
    const before = clock.now().getTime();
    clock.advanceMinutes(60); // advance 1 hour
    const after = clock.now().getTime();

    expect(clock.getOffsetMinutes()).toBe(60);
    // Difference should be approx 60 minutes = 3,600,000 ms
    expect(after - before).toBeGreaterThanOrEqual(3600000 - 100);
    expect(after - before).toBeLessThanOrEqual(3600000 + 100);
  });

  it("accumulates multiple time advances in demo mode", () => {
    clock.advanceMinutes(15);
    clock.advanceMinutes(30);
    expect(clock.getOffsetMinutes()).toBe(45);
  });

  it("resets offset to 0", () => {
    clock.advanceMinutes(120);
    expect(clock.getOffsetMinutes()).toBe(120);

    clock.reset();
    expect(clock.getOffsetMinutes()).toBe(0);
  });

  it("restores offset from system_settings row in database", async () => {
    // Simulate setting row in database
    const { prisma } = await import("../src/lib/prisma");
    const spy = vi.spyOn(prisma.systemSetting, "findUnique").mockResolvedValueOnce({
      key: "clock_offset_minutes",
      value: "90",
      updatedAt: new Date(),
    } as any);

    await clock.init();
    expect(clock.getOffsetMinutes()).toBe(90);
    spy.mockRestore();
  });
});
