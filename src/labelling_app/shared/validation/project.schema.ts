import { z } from 'zod';

/**
 * Schema for creating a new project
 */
export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
});

/**
 * Schema for updating a project
 */
export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
});

/**
 * Schema for project ID param
 */
export const projectIdSchema = z.object({
  projectId: z.string().min(1),
});

// Type inference helpers
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
