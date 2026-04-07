/**
 * Author: Xiaotian Lou
 * Date: 2026-03-04
 * Purpose: Integration tests for the health check endpoint.
 */
/**
 * Integration tests for src/routes/health.ts
 * Uses supertest to exercise the GET /health endpoint.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import healthRouter from "../routes/health";

const app = express();
app.use(healthRouter);

describe("GET /health", () => {
  it("returns 200 with { status: 'ok' }", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
