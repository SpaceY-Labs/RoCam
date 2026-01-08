/**
 * Organization-level roles
 */
export const ORG_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

/**
 * Project-level roles
 */
export const PROJECT_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  LABELER: 'labeler',
} as const;

/**
 * Role hierarchy for permission checks
 * Higher index = more permissions
 */
export const PROJECT_ROLE_HIERARCHY = ['labeler', 'admin', 'owner'] as const;

/**
 * Check if role has at least the required permission level
 * @param userRole - The user's current role
 * @param requiredRole - The minimum required role
 * @returns boolean indicating if user has sufficient permissions
 */
export function hasPermission(userRole: string, requiredRole: string): boolean {
  const userIndex = PROJECT_ROLE_HIERARCHY.indexOf(
    userRole as (typeof PROJECT_ROLE_HIERARCHY)[number]
  );
  const requiredIndex = PROJECT_ROLE_HIERARCHY.indexOf(
    requiredRole as (typeof PROJECT_ROLE_HIERARCHY)[number]
  );

  if (userIndex === -1 || requiredIndex === -1) {
    return false;
  }

  return userIndex >= requiredIndex;
}
