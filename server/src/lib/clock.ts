import { env } from "../config/env";

class ClockService {
  private offsetMinutes: number = 0;
  private demoModeOverride: boolean | null = null;

  private isDemoMode(): boolean {
    if (this.demoModeOverride !== null) {
      return this.demoModeOverride;
    }
    return env.DEMO_MODE;
  }

  public setDemoModeForTesting(enabled: boolean | null): void {
    this.demoModeOverride = enabled;
  }

  public now(): Date {
    const realNow = Date.now();
    if (!this.isDemoMode()) {
      return new Date(realNow);
    }
    return new Date(realNow + this.offsetMinutes * 60 * 1000);
  }

  public advanceMinutes(minutes: number): Date {
    if (this.isDemoMode()) {
      this.offsetMinutes += minutes;
    }
    return this.now();
  }

  public reset(): void {
    this.offsetMinutes = 0;
  }

  public getOffsetMinutes(): number {
    return this.isDemoMode() ? this.offsetMinutes : 0;
  }
}

export const clock = new ClockService();
