import { describe, it, expect, vi } from "vitest";
import { HttpError, notFound, errorHandler } from "../middleware/error";
import type { Request, Response, NextFunction } from "express";

// ============================================================================
// HttpError
// ============================================================================
describe("HttpError", () => {
  it("constructs with status, code and message", () => {
    const err = new HttpError(404, "NOT_FOUND", "Resource not found");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Resource not found");
  });

  it("extends Error so stack trace is available", () => {
    const err = new HttpError(500, "SERVER_ERROR", "oops");
    expect(err.stack).toBeDefined();
  });
});

// ============================================================================
// notFound middleware
// ============================================================================
describe("notFound", () => {
  const makeRes = () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return { status, json } as unknown as Response;
  };

  it("responds with 404 and NOT_FOUND error", () => {
    const req = {} as Request;
    const res = makeRes();
    notFound(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ============================================================================
// errorHandler middleware
// ============================================================================
describe("errorHandler", () => {
  const makeRes = () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return { res: { status, json } as unknown as Response, json, status };
  };

  const req = {} as Request;
  const next = vi.fn() as unknown as NextFunction;

  it("returns HttpError status and code for HttpError instances", () => {
    const { res, status } = makeRes();
    const err = new HttpError(422, "VALIDATION_ERROR", "Bad input");
    errorHandler(err, req, res, next);
    expect(status).toHaveBeenCalledWith(422);
  });

  it("returns 500 for generic Error", () => {
    const { res, status } = makeRes();
    const err = new Error("something went wrong");
    errorHandler(err, req, res, next);
    expect(status).toHaveBeenCalledWith(500);
  });

  it("returns 500 for non-Error thrown value", () => {
    const { res, status } = makeRes();
    errorHandler("string error", req, res, next);
    expect(status).toHaveBeenCalledWith(500);
  });
});

// ============================================================================
// asyncHandler
// ============================================================================
describe("asyncHandler (re-exported via middleware)", () => {
  it("is importable from asyncHandler module", async () => {
    const { asyncHandler } = await import("../middleware/asyncHandler");
    expect(typeof asyncHandler).toBe("function");
  });

  it("passes request to async handler and calls next on rejection", async () => {
    const { asyncHandler } = await import("../middleware/asyncHandler");
    const next = vi.fn();
    const error = new Error("async fail");
    const handler = asyncHandler(async (_req, _res, _next) => {
      throw error;
    });
    const req = {} as Request;
    const res = {} as Response;
    handler(req, res, next);
    await new Promise((r) => setTimeout(r, 0)); // flush microtasks
    expect(next).toHaveBeenCalledWith(error);
  });

  it("resolves without calling next when handler succeeds", async () => {
    const { asyncHandler } = await import("../middleware/asyncHandler");
    const next = vi.fn();
    const handler = asyncHandler(async (_req, _res, _next) => {
      // success: no throw
    });
    const req = {} as Request;
    const res = {} as Response;
    handler(req, res, next);
    await new Promise((r) => setTimeout(r, 0));
    expect(next).not.toHaveBeenCalled();
  });
});
