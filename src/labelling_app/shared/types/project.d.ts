import type { Timestamp } from 'firebase/firestore';
/**
 * Project entity representing a labeling project
 */
export interface Project {
    id: string;
    orgId: string;
    name: string;
    description: string;
    ownerId: string;
    memberIds: string[];
    stats: ProjectStats;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
/**
 * Denormalized statistics for quick dashboard display
 */
export interface ProjectStats {
    totalImages: number;
    labeledImages: number;
    inProgressImages: number;
}
/**
 * Project creation payload
 */
export interface CreateProjectInput {
    name: string;
    description?: string;
}
/**
 * Project update payload
 */
export interface UpdateProjectInput {
    name?: string;
    description?: string;
}
//# sourceMappingURL=project.d.ts.map