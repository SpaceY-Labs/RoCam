import type { Timestamp } from 'firebase/firestore';

/**
 * Organization entity representing a company/team using the platform
 */
export interface Organization {
  id: string;
  name: string;
  createdAt: Timestamp;
}

/**
 * Organization member with role assignment
 */
export interface OrganizationMember {
  userId: string;
  role: OrganizationRole;
  joinedAt: Timestamp;
}

/**
 * Available roles within an organization
 */
export type OrganizationRole = 'owner' | 'admin' | 'member';
