import { env } from "../config/env";
import { prisma } from "./prisma";

class ClockService {
  private offsetMinutes: number = 0;
  private demoModeOverride: boolean | null = null;
  private isInitialized: boolean = false;

  private isDemoMode(): boolean {
    if (this.demoModeOverride !== null) {
      return this.demoModeOverride;
    }
    return env.DEMO_MODE;
  }

  public setDemoModeForTesting(enabled: boolean | null): void {
    this.demoModeOverride = enabled;
  }

  public async init(): Promise<void> {
    if (!this.isDemoMode()) return;
    try {
      const setting = await prisma.systemSetting.findUnique({
        where: { key: "clock_offset_minutes" },
      });
      if (setting) {
        this.offsetMinutes = parseInt(setting.value, 10) || 0;
      }
    } catch {
      // In case table not yet created or DB disconnected, keep in-memory fallback
    }
    this.isInitialized = true;
  }

  public now(): Date {
    const realNow = Date.now();
    if (!this.isDemoMode()) {
      return new Date(realNow);
    }
    return new Date(realNow + this.offsetMinutes * 60 * 1000);
  }

  public async advanceMinutes(minutes: number): Promise<Date> {
    if (this.isDemoMode()) {
      this.offsetMinutes += minutes;
      try {
        await prisma.systemSetting.upsert({
          where: { key: "clock_offset_minutes" },
          create: { key: "clock_offset_minutes", value: String(this.offsetMinutes) },
          update: { value: String(this.offsetMinutes) },
        });
      } catch (err) {
        // Continue with in-memory offset if DB write fails
      }
    }
    return this.now();
  }

  public async reset(): Promise<void> {
    this.offsetMinutes = 0;
    if (this.isDemoMode()) {
      try {
        await prisma.systemSetting.upsert({
          where: { key: "clock_offset_minutes" },
          create: { key: "clock_offset_minutes", value: "0" },
          update: { value: "0" },
        });
      } catch (err) {
        // Continue with in-memory reset if DB write fails
      }
    }
  }

  public getOffsetMinutes(): number {
    return this.isDemoMode() ? this.offsetMinutes : 0;
  }
}

export const clock = new ClockService();
