import { Router } from 'express';
import { z } from 'zod';
import { validate, validateParams } from '../middleware/validation.middleware.js';
import { validation } from 'shared';

const projectParams = z.object({ projectId: z.string().min(1) }).passthrough();
const exportParams = z.object({
  projectId: z.string().min(1),
  exportId: z.string().min(1),
});

export function createExportRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post(
    '/',
    validateParams(projectParams),
    validate(validation.startExportSchema),
    (req, res) => res.json({ success: true })
  );
  router.get('/:exportId', validateParams(exportParams), (req, res) =>
    res.json({ success: true })
  );
  router.get('/', validateParams(projectParams), (req, res) => res.json([]));
  router.delete('/:exportId', validateParams(exportParams), (req, res) =>
    res.json({ success: true })
  );

  return router;
}
