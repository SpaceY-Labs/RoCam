import { Router } from 'express';
import { z } from 'zod';
import { validate, validateParams } from '../middleware/validation.middleware.js';
import { validation } from 'shared';

const projectParams = z.object({ projectId: z.string().min(1) }).passthrough();

export function createAssignmentRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post(
    '/assign',
    validateParams(projectParams),
    validate(validation.assignRequestSchema),
    (req, res) =>
      res.json({
        success: true,
        assigned: {},
        summary: { totalMoved: 0, poolRemaining: 0 },
      })
  );
  router.get('/my-queue', validateParams(projectParams), (req, res) =>
    res.json([])
  );
  router.post('/release', validateParams(projectParams), (req, res) =>
    res.json({ released: 0 })
  );
  router.post('/refresh-locks', validateParams(projectParams), (req, res) =>
    res.json({ success: true })
  );

  return router;
}
