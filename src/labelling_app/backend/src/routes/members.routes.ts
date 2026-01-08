import { Router } from 'express';
import { z } from 'zod';
import { validate, validateParams } from '../middleware/validation.middleware.js';
import { validation } from 'shared';

const projectParams = z.object({ projectId: z.string().min(1) }).passthrough();
const memberParams = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
});

export function createMembersRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get('/', validateParams(projectParams), (req, res) => res.json([]));
  router.post(
    '/',
    validateParams(projectParams),
    validate(validation.inviteMemberSchema),
    (req, res) => res.json({ success: true })
  );
  router.patch(
    '/:userId',
    validateParams(memberParams),
    validate(validation.updateMemberSchema),
    (req, res) => res.json({ success: true })
  );
  router.delete('/:userId', validateParams(memberParams), (req, res) =>
    res.json({ success: true })
  );
  router.post('/leave', validateParams(projectParams), (req, res) =>
    res.json({ success: true })
  );

  return router;
}
