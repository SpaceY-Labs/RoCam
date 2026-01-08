import { Router } from 'express';
import { z } from 'zod';
import { validate, validateParams } from '../middleware/validation.middleware.js';
import { validation } from 'shared';

const projectIdParams = z.object({ projectId: z.string().min(1) });

export function createProjectsRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => res.json([]));
  router.post('/', validate(validation.createProjectSchema), (req, res) =>
    res.json({ success: true })
  );
  router.get('/:projectId', validateParams(projectIdParams), (req, res) =>
    res.json({ success: true })
  );
  router.patch(
    '/:projectId',
    validateParams(projectIdParams),
    validate(validation.updateProjectSchema),
    (req, res) => res.json({ success: true })
  );
  router.delete('/:projectId', validateParams(projectIdParams), (req, res) =>
    res.json({ success: true })
  );
  router.get('/:projectId/stats', validateParams(projectIdParams), (req, res) =>
    res.json({ success: true })
  );

  return router;
}
