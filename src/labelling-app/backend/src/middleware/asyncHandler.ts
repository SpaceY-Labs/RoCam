/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Wrap async Express route handlers to forward rejected promises to error middleware.
 */
import type { Request, Response, NextFunction } from "express";

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

export const asyncHandler = (handler: AsyncHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
};
