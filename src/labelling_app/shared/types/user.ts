import type { Timestamp } from 'firebase/firestore';

/**
 * User profile stored in Firestore
 */
export interface User {
  id: string;
  email: string;
  displayName: string;
  orgId: string; // Default: "rocam"
  createdAt: Timestamp;
  lastActiveAt: Timestamp;
}

/**
 * User creation payload
 */
export interface CreateUserInput {
  email: string;
  displayName: string;
  orgId?: string;
}

/**
 * User update payload
 */
export interface UpdateUserInput {
  displayName?: string;
}
