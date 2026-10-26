import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("ignores time offset when demo mode is disabled", () => {
    clock.setDemoModeForTesting(false);

    const before = clock.now().getTime();
    clock.advanceMinutes(120);
    const after = clock.now().getTime();

    expect(clock.getOffsetMinutes()).toBe(0);
    expect(after - before).toBeLessThan(100);
  });
});
