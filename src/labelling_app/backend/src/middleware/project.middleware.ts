import { Request, Response, NextFunction } from 'express';
import { getProject } from '../models/project.model.js';
import { getMember } from '../models/member.model.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import { Project, ProjectMember } from 'shared';

declare global {
  namespace Express {
    interface Request {
      project?: Project;
      membership?: ProjectMember;
    }
  }
}

export async function projectMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { projectId } = req.params;
    const userId = req.user?.uid;

    if (!projectId) {
      throw new NotFoundError('Project', 'missing');
    }

    if (!userId) {
      throw new ForbiddenError('Authentication required');
    }

    const [project, membership] = await Promise.all([
      getProject(projectId),
      getMember(projectId, userId),
    ]);

    if (!project) {
      throw new NotFoundError('Project', projectId);
    }

    if (!membership) {
      throw new ForbiddenError('Not a member of this project');
    }

    req.project = { ...project, id: projectId };
    req.membership = membership;

    next();
  } catch (error) {
    next(error);
  }
}







