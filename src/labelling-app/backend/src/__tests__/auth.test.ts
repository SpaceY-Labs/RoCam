/**
 * Author: Xiaotian Lou
 * Date: 2026-03-04
 * Purpose: Unit tests for Firebase authentication middleware.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/auth";

// Mock firebase module to avoid real credentials
vi.mock("../firebase", () => ({
  auth: {
    verifyIdToken: vi.fn(),
  },
  storage: {
    bucket: vi.fn().mockReturnValue({}),
  },
}));

// Config mock – requireAuth starts as true
const configMock = {
  requireAuth: true,
};
vi.mock("../config", () => ({
  config: configMock,
}));

const makeReqRes = (headers: Record<string, string> = {}, method = "GET") => {
  const req: Partial<Request> = { headers, method } as Partial<Request>;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req: req as AuthenticatedRequest, res, next, json, status };
};

describe("authenticate middleware", () => {
  let authenticate: typeof import("../middleware/auth")["authenticate"];
  let authMock: { verifyIdToken: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.resetModules();
    configMock.requireAuth = true;

    const authModule = await import("../middleware/auth");
    authenticate = authModule.authenticate;

    const firebase = await import("../firebase");
    authMock = firebase.auth as unknown as { verifyIdToken: ReturnType<typeof vi.fn> };
  });

  it("calls next immediately for OPTIONS requests", async () => {
    const { req, res, next } = makeReqRes({}, "OPTIONS");
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("assigns dev user and calls next when requireAuth is false", async () => {
    configMock.requireAuth = false;
    const { req, res, next } = makeReqRes({}, "GET");
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ uid: "dev", token: {} });
  });

  it("returns 401 when Authorization header is missing", async () => {
    const { req, res, next, status } = makeReqRes({}, "GET");
    await authenticate(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header has wrong prefix", async () => {
    const { req, res, next, status } = makeReqRes({ authorization: "Basic abc123" }, "GET");
    await authenticate(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when Bearer token is empty", async () => {
    const { req, res, next, status } = makeReqRes({ authorization: "Bearer " }, "GET");
    await authenticate(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
  });

  it("sets user and calls next when token is valid", async () => {
    authMock.verifyIdToken.mockResolvedValueOnce({ uid: "user-123", email: "x@y.com" });
    const { req, res, next } = makeReqRes({ authorization: "Bearer valid-token" }, "GET");
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.uid).toBe("user-123");
    expect(req.user?.email).toBe("x@y.com");
  });

  it("returns 401 when verifyIdToken throws", async () => {
    authMock.verifyIdToken.mockRejectedValueOnce(new Error("expired"));
    const { req, res, next, status } = makeReqRes({ authorization: "Bearer bad-token" }, "GET");
    await authenticate(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
