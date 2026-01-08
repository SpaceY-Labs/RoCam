import { Router } from 'express';
import { z } from 'zod';
import { validate, validateParams } from '../middleware/validation.middleware.js';
import { validation } from 'shared';
import * as labelingService from '../services/labeling/mask.service.js';
import * as imageService from '../services/image/image.service.js';
import * as uploadService from '../services/image/upload.service.js';

const imageParams = z.object({
  projectId: z.string().min(1),
  imageId: z.string().min(1),
});

export function createLabelingRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get('/:imageId/for-labeling', validateParams(imageParams), async (req, res, next) => {
    try {
      const { projectId, imageId } = req.params as {
        projectId: string;
        imageId: string;
      };
      const [image, masks] = await Promise.all([
        imageService.getImage(projectId, imageId),
        labelingService.getMasks(projectId, imageId),
      ]);

      const signedImageUrl = await uploadService.getDownloadUrl(
        image.storagePath,
        60 * 60 * 1000
      );

      res.json({ image, masks, signedImageUrl });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:imageId/masks', validateParams(imageParams), async (req, res, next) => {
    try {
      const { projectId, imageId } = req.params as {
        projectId: string;
        imageId: string;
      };
      const masks = await labelingService.getMasks(projectId, imageId);
      res.json(masks);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/:imageId/masks',
    validateParams(imageParams),
    validate(validation.saveMasksSchema),
    async (req, res, next) => {
      try {
        const { projectId, imageId } = req.params as {
          projectId: string;
          imageId: string;
        };
        const userId = req.user!.uid;

        const savedMasks = await labelingService.saveMasks(
          projectId,
          imageId,
          req.body,
          userId
        );

        res.json(savedMasks);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
