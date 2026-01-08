import { Request, Response, NextFunction } from 'express';
import { AppError, InternalError } from '../utils/errors.js';

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const error = err instanceof AppError ? err : new InternalError();
  res.status(error.statusCode).json({
    success: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  });
}




