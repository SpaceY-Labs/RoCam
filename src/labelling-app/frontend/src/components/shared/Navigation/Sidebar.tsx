/**
 * Sidebar - Main navigation sidebar component
 * Provides navigation between app routes and displays active project info
 */

import type { RouteId, Project, NavItem } from '../../../types';
import './Sidebar.css';

// ============ Constants ============
export const NAV_ITEMS: NavItem[] = [
  {
    id: 'projects',
    label: 'Projects',
    description: 'Browse and select',
    icon: 'P',
  },
  {
    id: 'create',
    label: 'Create',
    description: 'New project setup',
    icon: 'C',
  },
  {
    id: 'label',
    label: 'Label',
    description: 'Annotate images',
    icon: 'L',
  },
  {
    id: 'upload',
    label: 'Upload',
    description: 'Add new images',
    icon: 'U',
  },
  {
    id: 'preview',
    label: 'Manage',
    description: 'Review + update',
    icon: 'M',
  },
];

// ============ Types ============
export interface SidebarProps {
  /** Current active route */
  currentRoute: RouteId;
  /** Currently selected project */
  selectedProject: Project | null;
  /** Whether the queue is loading */
  queueLoading?: boolean;
  /** Callback when a nav item is clicked */
  onNavigate: (route: RouteId) => void;
}

// ============ Component ============
export function Sidebar({
  currentRoute,
  selectedProject,
  queueLoading = false,
  onNavigate,
}: SidebarProps) {
  return (
    <aside className="side-nav">
      <div className="nav-rail">
        {/* Brand Header */}
        <div className="nav-brand">
          <span className="brand-mark" />
          <div className="brand-copy">
            <span className="eyebrow">RoCam Labeler</span>
            <span className="brand-title">Studio</span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="nav-list">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={currentRoute === item.id ? 'nav-link active' : 'nav-link'}
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">
                <span className="nav-title">{item.label}</span>
                <span className="nav-subtitle">{item.description}</span>
              </span>
            </button>
          ))}
        </nav>

        {/* Footer - Active Project Info */}
        <div className="nav-footer">
          <div className="active-project">
            <p className="meta-label">Active project</p>
            <p className="meta-value">
              {selectedProject?.name || 'None selected'}
            </p>
            {selectedProject && (
              <p className="muted small">
                {selectedProject.unlabeledCount ?? selectedProject.imageCount ?? 0} unlabeled
              </p>
            )}
          </div>
          <div className="status-row">
            <span className={queueLoading ? 'status-dot pulse' : 'status-dot'} />
            {queueLoading ? 'Syncing...' : 'Ready'}
          </div>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
