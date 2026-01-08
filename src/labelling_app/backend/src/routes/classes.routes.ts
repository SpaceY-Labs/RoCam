import { Router } from 'express';
import { z } from 'zod';
import { validate, validateParams } from '../middleware/validation.middleware.js';
import { validation } from 'shared';

const projectParams = z.object({ projectId: z.string().min(1) }).passthrough();
const classParams = z.object({
  projectId: z.string().min(1),
  classId: z.string().min(1),
});

export function createClassesRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get('/', validateParams(projectParams), (req, res) => res.json([]));
  router.post(
    '/',
    validateParams(projectParams),
    validate(validation.createClassSchema),
    (req, res) => res.json({ success: true })
  );
  router.patch(
    '/:classId',
    validateParams(classParams),
    validate(validation.updateClassSchema),
    (req, res) => res.json({ success: true })
  );
  router.delete('/:classId', validateParams(classParams), (req, res) =>
    res.json({ success: true })
  );
  router.post(
    '/reorder',
    validateParams(projectParams),
    validate(validation.reorderClassesSchema),
    (req, res) => res.json({ success: true })
  );

  return router;
}
