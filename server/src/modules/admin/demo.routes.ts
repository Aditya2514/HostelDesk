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

demoRouter.post("/advance-time", (req: Request, res: Response) => {
  const parsed = advanceTimeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid payload");
  }

  const newTime = clock.advanceMinutes(parsed.data.minutes);
  res.status(200).json({
    currentClock: newTime.toISOString(),
    offsetMinutes: clock.getOffsetMinutes(),
  });
});

demoRouter.post("/reset-time", (_req: Request, res: Response) => {
  clock.reset();
  res.status(200).json({
    currentClock: clock.now().toISOString(),
    offsetMinutes: 0,
  });
});
