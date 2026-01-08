/**
 * Organization-level roles
 */
export declare const ORG_ROLES: {
    readonly OWNER: "owner";
    readonly ADMIN: "admin";
    readonly MEMBER: "member";
};
/**
 * Project-level roles
 */
export declare const PROJECT_ROLES: {
    readonly OWNER: "owner";
    readonly ADMIN: "admin";
    readonly LABELER: "labeler";
};
/**
 * Role hierarchy for permission checks
 * Higher index = more permissions
 */
export declare const PROJECT_ROLE_HIERARCHY: readonly ["labeler", "admin", "owner"];
/**
 * Check if role has at least the required permission level
 * @param userRole - The user's current role
 * @param requiredRole - The minimum required role
 * @returns boolean indicating if user has sufficient permissions
 */
export declare function hasPermission(userRole: string, requiredRole: string): boolean;
//# sourceMappingURL=roles.d.ts.map