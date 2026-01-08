"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROJECT_ROLE_HIERARCHY = exports.PROJECT_ROLES = exports.ORG_ROLES = void 0;
exports.hasPermission = hasPermission;
/**
 * Organization-level roles
 */
exports.ORG_ROLES = {
    OWNER: 'owner',
    ADMIN: 'admin',
    MEMBER: 'member',
};
/**
 * Project-level roles
 */
exports.PROJECT_ROLES = {
    OWNER: 'owner',
    ADMIN: 'admin',
    LABELER: 'labeler',
};
/**
 * Role hierarchy for permission checks
 * Higher index = more permissions
 */
exports.PROJECT_ROLE_HIERARCHY = ['labeler', 'admin', 'owner'];
/**
 * Check if role has at least the required permission level
 * @param userRole - The user's current role
 * @param requiredRole - The minimum required role
 * @returns boolean indicating if user has sufficient permissions
 */
function hasPermission(userRole, requiredRole) {
    const userIndex = exports.PROJECT_ROLE_HIERARCHY.indexOf(userRole);
    const requiredIndex = exports.PROJECT_ROLE_HIERARCHY.indexOf(requiredRole);
    if (userIndex === -1 || requiredIndex === -1) {
        return false;
    }
    return userIndex >= requiredIndex;
}
