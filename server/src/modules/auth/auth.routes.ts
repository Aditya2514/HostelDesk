import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AuthController } from "./auth.controller";
import { requireAuth } from "../../middleware/auth.middleware";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many login attempts. Please try again after 15 minutes.",
    },
  },
});

authRouter.post("/login", loginLimiter, AuthController.login);
authRouter.post("/logout", AuthController.logout);
authRouter.get("/me", requireAuth, AuthController.me);
