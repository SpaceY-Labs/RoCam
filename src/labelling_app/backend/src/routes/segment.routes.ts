import { Router } from 'express';
import { validate } from '../middleware/validation.middleware.js';
import { validation } from 'shared';
import * as segmentService from '../services/segment/segment.service.js';

export function createSegmentRouter(): Router {
  const router = Router();

  router.post(
    '/click',
    validate(validation.clickSegmentSchema),
    async (req, res, next) => {
      try {
        const { imageUrl, points, box } = req.body;
        const result = await segmentService.clickSegment(imageUrl, points, box);
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/auto',
    validate(validation.autoSegmentSchema),
    async (req, res, next) => {
      try {
        const { imageUrl } = req.body;
        const result = await segmentService.autoSegment(imageUrl);
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/semantic',
    validate(validation.semanticSegmentSchema),
    async (req, res, next) => {
      try {
        const { imageUrl, prompt } = req.body;
        const result = await segmentService.semanticSegment(imageUrl, prompt);
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
