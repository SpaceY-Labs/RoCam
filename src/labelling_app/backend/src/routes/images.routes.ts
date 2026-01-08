import { Router } from 'express';
import { z } from 'zod';
import {
  validate,
  validateParams,
  validateQuery,
} from '../middleware/validation.middleware.js';
import { validation } from 'shared';

const projectParams = z.object({ projectId: z.string().min(1) }).passthrough();
const imageParams = z.object({
  projectId: z.string().min(1),
  imageId: z.string().min(1),
});

export function createImagesRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/',
    validateParams(projectParams),
    validateQuery(validation.imageListQuerySchema),
    (req, res) => res.json({ items: [], cursor: null, hasMore: false })
  );
  router.post(
    '/upload-urls',
    validateParams(projectParams),
    validate(validation.getUploadUrlsSchema),
    (req, res) => res.json([])
  );
  router.post(
    '/confirm-upload',
    validateParams(projectParams),
    validate(validation.confirmUploadSchema),
    (req, res) => res.json({ success: true })
  );
  router.get('/:imageId', validateParams(imageParams), (req, res) =>
    res.json({ success: true })
  );
  router.delete('/:imageId', validateParams(imageParams), (req, res) =>
    res.json({ success: true })
  );
  router.post(
    '/bulk-delete',
    validateParams(projectParams),
    validate(validation.bulkDeleteSchema),
    (req, res) => res.json({ success: true })
  );

  return router;
}
