import { Request, Response, NextFunction } from 'express';
import { hasPermission } from 'shared';
import { ProjectRole } from 'shared';
import { ForbiddenError } from '../utils/errors.js';

export function roleMiddleware(requiredRole: ProjectRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = req.membership?.role;

    if (!userRole) {
      return next(new ForbiddenError('Membership not found'));
    }

    if (!hasPermission(userRole, requiredRole)) {
      return next(
        new ForbiddenError(`Requires ${requiredRole} role, you have ${userRole}`)
      );
    }

    next();
  };
}






