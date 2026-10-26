import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { clock } from "../../lib/clock";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";

export const demoRouter = Router();

// In DEMO_MODE=false, return 404 for all demo routes
demoRouter.use((_req: Request, _res: Response, next: NextFunction) => {
  if (!env.DEMO_MODE) {
    return next(new AppError(404, "NOT_FOUND", "Demo mode is disabled"));
  }
  next();
});

// Demo admin operations require ADMIN role
demoRouter.use(requireAuth, requireRole("ADMIN"));

const advanceTimeSchema = z.object({
  minutes: z.number().int().positive("Minutes must be a positive integer"),
});

import { JobsService } from "../../jobs";

demoRouter.post("/advance-time", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = advanceTimeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid payload");
    }

    const newTime = await clock.advanceMinutes(parsed.data.minutes);

    // Immediately evaluate escalations & auto-closes triggered by time-travel
    let jobsSummary = undefined;
    try {
      jobsSummary = await JobsService.runTick();
    } catch (err) {
      console.error("[advance-time] Jobs tick failed after time advance:", err);
    }

    res.status(200).json({
      currentClock: newTime.toISOString(),
      offsetMinutes: clock.getOffsetMinutes(),
      jobsRan: jobsSummary,
    });
  } catch (err) {
    next(err);
  }
});

demoRouter.post("/reset-time", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await clock.reset();
    res.status(200).json({
      currentClock: clock.now().toISOString(),
      offsetMinutes: 0,
    });
  } catch (err) {
    next(err);
  }
});
