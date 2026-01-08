import type { Timestamp } from 'firebase/firestore';

/**
 * Project member with role and quota
 */
export interface ProjectMember {
  userId: string;
  role: ProjectRole;
  quota: number | null; // null = unlimited
  stats: MemberStats;
  joinedAt: Timestamp;
}

/**
 * Member labeling statistics
 */
export interface MemberStats {
  assigned: number;
  labeled: number;
}

/**
 * Available roles within a project
 */
export type ProjectRole = 'owner' | 'admin' | 'labeler';

/**
 * Invite member payload
 */
export interface InviteMemberInput {
  email: string;
  role: ProjectRole;
  quota?: number | null;
}

/**
 * Update member payload
 */
export interface UpdateMemberInput {
  role?: ProjectRole;
  quota?: number | null;
}
