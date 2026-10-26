import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { authRouter } from "../src/modules/auth/auth.routes";
import { errorHandler } from "../src/lib/errors";

import { AuthService } from "../src/modules/auth/auth.service";
import { AppError } from "../src/lib/errors";

describe("Login Rate Limiter (Per Email)", () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use(errorHandler);

  beforeEach(() => {
    vi.spyOn(AuthService, "login").mockRejectedValue(
      new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password")
    );
  });

  it("limits login attempts per lowercased email and does not block a different email", async () => {
    const targetEmail = "victim@hosteldesk.dev";
    const differentEmail = "innocent@hosteldesk.dev";

    // 10 failed login attempts for targetEmail
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: targetEmail, password: "wrongpassword" });

      expect(res.status).not.toBe(429);
    }

    // 11th attempt for targetEmail should be blocked by rate limiter
    const blockedRes = await request(app)
      .post("/api/auth/login")
      .send({ email: targetEmail, password: "wrongpassword" });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error?.code).toBe("RATE_LIMITED");

    // Case-insensitive test: uppercase targetEmail should also be blocked
    const upperBlockedRes = await request(app)
      .post("/api/auth/login")
      .send({ email: targetEmail.toUpperCase(), password: "wrongpassword" });

    expect(upperBlockedRes.status).toBe(429);

    // Different email from the exact same IP should NOT be blocked
    const differentRes = await request(app)
      .post("/api/auth/login")
      .send({ email: differentEmail, password: "wrongpassword" });

    expect(differentRes.status).not.toBe(429);
  });
});
