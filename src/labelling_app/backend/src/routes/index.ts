import { Router } from 'express';
import { loggingMiddleware } from '../middleware/logging.middleware.js';
import { errorMiddleware } from '../middleware/error.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { projectMiddleware } from '../middleware/project.middleware.js';

import { createAuthRouter } from './auth.routes.js';
import { createProjectsRouter } from './projects.routes.js';
import { createMembersRouter } from './members.routes.js';
import { createClassesRouter } from './classes.routes.js';
import { createImagesRouter } from './images.routes.js';
import { createAssignmentRouter } from './assignment.routes.js';
import { createLabelingRouter } from './labeling.routes.js';
import { createSegmentRouter } from './segment.routes.js';
import { createExportRouter } from './export.routes.js';
import { createAnalyticsRouter } from './analytics.routes.js';

export function createRouter(): Router {
  const router = Router();

  router.use(loggingMiddleware);

  router.get('/health', (req, res) => res.json({ status: 'ok' }));

  router.use('/auth', createAuthRouter());
  router.use(authMiddleware);

  router.use('/projects', createProjectsRouter());

  const projectRouter = Router({ mergeParams: true });
  projectRouter.use(projectMiddleware);
  projectRouter.use('/members', createMembersRouter());
  projectRouter.use('/classes', createClassesRouter());
  projectRouter.use('/images', createImagesRouter());
  projectRouter.use('/', createAssignmentRouter());
  projectRouter.use('/images', createLabelingRouter());
  projectRouter.use('/export', createExportRouter());
  projectRouter.use('/analytics', createAnalyticsRouter());

  router.use('/projects/:projectId', projectRouter);

  router.use('/segment', createSegmentRouter());

  router.use(errorMiddleware);

  return router;
}




