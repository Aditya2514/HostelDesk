import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler, AppError } from "./lib/errors";

export const app: Application = express();

// Trust reverse proxy (e.g. Render / Cloudflare) for accurate client IP rate limiting
app.set("trust proxy", 1);

// Security and utility middleware
app.use(helmet());
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
if (env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// Health check endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

import { EtaService } from "./modules/scheduling/eta.service";

// Scheduled jobs keep-awake endpoint (recomputes all staff queues)
app.post("/api/jobs/tick", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secretHeader = req.headers["x-jobs-secret"];
    if (!secretHeader || secretHeader !== env.JOBS_SECRET) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid or missing jobs secret header");
    }
    const result = await EtaService.recomputeAllStaffQueues("scheduled time tick");
    res.status(200).json({ ran: ["recompute_staff_queues"], ...result });
  } catch (error) {
    next(error);
  }
});

// Auth routes
import { authRouter } from "./modules/auth/auth.routes";
app.use("/api/auth", authRouter);

// Ticket routes
import { ticketRouter } from "./modules/tickets/tickets.routes";
app.use("/api/tickets", ticketRouter);

// Notification routes
import { notificationRouter } from "./modules/notifications/notification.routes";
app.use("/api/notifications", notificationRouter);

// Category routes
import { categoryRouter } from "./modules/categories/categories.routes";
app.use("/api/categories", categoryRouter);

// Staff routes
import { staffRouter } from "./modules/staff/staff.routes";
app.use("/api/staff", staffRouter);

// Admin demo routes
import { demoRouter } from "./modules/admin/demo.routes";
app.use("/api/admin/demo", demoRouter);

// Central error handler
app.use(errorHandler);
