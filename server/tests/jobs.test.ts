import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { env } from "../src/config/env";

describe("Jobs Tick Endpoint (POST /api/jobs/tick)", () => {
  it("returns 401 when x-jobs-secret header is missing", async () => {
    const res = await request(app).post("/api/jobs/tick");
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when x-jobs-secret header is invalid", async () => {
    const res = await request(app)
      .post("/api/jobs/tick")
      .set("x-jobs-secret", "wrong-secret-token");

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 with { ran: [] } when x-jobs-secret header is correct", async () => {
    const res = await request(app)
      .post("/api/jobs/tick")
      .set("x-jobs-secret", env.JOBS_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ran: [] });
  });

  it("returns 200 on health check GET /api/health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
