/**
 * Navigation items and types for Sidebar
 */

import type { RouteId, Project, NavItem } from '../../../types';

export const NAV_ITEMS: NavItem[] = [
  { id: 'projects', label: 'Projects', description: 'Browse and select', icon: 'P' },
  { id: 'create', label: 'Create', description: 'New project setup', icon: 'C' },
  { id: 'upload', label: 'Upload', description: 'Add new images', icon: 'U' },
  { id: 'preview', label: 'Manage', description: 'Review + update', icon: 'M' },
];

export interface SidebarProps {
  currentRoute: RouteId;
  selectedProject: Project | null;
  onNavigate: (route: RouteId) => void;
}
