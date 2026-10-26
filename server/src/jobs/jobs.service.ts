import { AutoCloseJob, AutoCloseJobResult } from "./autoclose.job";
import { EscalationJob, EscalationJobResult } from "./escalation.job";
import { EtaService } from "../modules/scheduling/eta.service";

export interface TickJobResult {
  ran: string[];
  autoClosedCount: number;
  unableToAccessCount: number;
  level1EscalatedCount: number;
  level2EscalatedCount: number;
  totalEscalatedCount: number;
  recomputedStaffCount: number;
}

export class JobsService {
  /**
   * Main entrypoint for /api/jobs/tick.
   * Runs auto-close checks, escalation checks, and staff queue ETA recomputations.
   */
  static async runTick(): Promise<TickJobResult> {
    const autoCloseRes: AutoCloseJobResult = await AutoCloseJob.run();
    const escalationRes: EscalationJobResult = await EscalationJob.run();
    const etaRes = await EtaService.recomputeAllStaffQueues("TICK");

    return {
      ran: ["auto_close", "escalation", "recompute_staff_queues"],
      autoClosedCount: autoCloseRes.autoClosedCount,
      unableToAccessCount: autoCloseRes.unableToAccessCount,
      level1EscalatedCount: escalationRes.level1EscalatedCount,
      level2EscalatedCount: escalationRes.level2EscalatedCount,
      totalEscalatedCount: escalationRes.totalEscalatedCount,
      recomputedStaffCount: etaRes.recomputedStaffCount,
    };
  }
}
