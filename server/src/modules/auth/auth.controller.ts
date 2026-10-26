import { Request, Response, NextFunction } from "express";
import { CookieOptions } from "express";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { loginSchema } from "./auth.schema";
import { AuthService } from "./auth.service";

const getCookieOptions = (): CookieOptions => {
  const isProd = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  };
};

export class AuthController {
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid input");
      }

      const { token, user } = await AuthService.login(parsed.data.email, parsed.data.password);

      res.cookie("token", token, getCookieOptions());

      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  }

  static async logout(_req: Request, res: Response, next: NextFunction) {
    try {
      const isProd = env.NODE_ENV === "production";
      res.clearCookie("token", {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
      });

      res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
      next(error);
    }
  }

  static async me(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      }

      const user = await AuthService.getCurrentUser(req.user.id);
      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  }
}
