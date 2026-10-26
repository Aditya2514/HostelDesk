import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AuthController } from "./auth.controller";
import { requireAuth } from "../../middleware/auth.middleware";

export const authRouter = Router();

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return email || req.ip || "unknown";
  },
  validate: { xForwardedForHeader: false },
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many login attempts for this account. Please try again after 15 minutes.",
    },
  },
});

authRouter.post("/login", loginLimiter, AuthController.login);
authRouter.post("/logout", AuthController.logout);
authRouter.get("/me", requireAuth, AuthController.me);
