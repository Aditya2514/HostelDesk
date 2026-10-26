import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler, AppError } from "./lib/errors";

export const app: Application = express();

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

// Placeholder for scheduled jobs keep-awake endpoint (Phase 5 will add job logic)
app.post("/api/jobs/tick", (req: Request, res: Response) => {
  const secretHeader = req.headers["x-jobs-secret"];
  if (!secretHeader || secretHeader !== env.JOBS_SECRET) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid or missing jobs secret header");
  }
  res.status(200).json({ ran: [] });
});

// Central error handler
app.use(errorHandler);
