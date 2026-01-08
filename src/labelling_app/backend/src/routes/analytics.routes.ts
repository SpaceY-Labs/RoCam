import { Router } from 'express';
import { z } from 'zod';
import { validateParams } from '../middleware/validation.middleware.js';

const projectParams = z.object({ projectId: z.string().min(1) }).passthrough();

export function createAnalyticsRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get('/', validateParams(projectParams), (req, res) =>
    res.json({ success: true })
  );
  router.get('/team', validateParams(projectParams), (req, res) => res.json([]));
  router.get('/me', validateParams(projectParams), (req, res) =>
    res.json({ success: true })
  );

  return router;
}
