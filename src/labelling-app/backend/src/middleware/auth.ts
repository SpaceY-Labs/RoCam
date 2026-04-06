/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Firebase Authentication middleware that verifies ID tokens on incoming requests.
 */
import type { Request, Response, NextFunction } from "express";
import { auth } from "../firebase";
import { config } from "../config";

export type AuthUser = {
  uid: string;
  email?: string;
  token: unknown;
};

export type AuthenticatedRequest = Request & { user?: AuthUser };

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (req.method === "OPTIONS") {
    return next();
  }

  if (!config.requireAuth) {
    (req as AuthenticatedRequest).user = { uid: "dev", token: {} };
    return next();
  }

  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Missing Authorization header",
    });
  }

  const idToken = header.slice("Bearer ".length).trim();
  if (!idToken) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Invalid Authorization header",
    });
  }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    (req as AuthenticatedRequest).user = {
      uid: decoded.uid,
      email: decoded.email,
      token: decoded,
    };
    return next();
  } catch (error) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Invalid or expired token",
    });
  }
};
