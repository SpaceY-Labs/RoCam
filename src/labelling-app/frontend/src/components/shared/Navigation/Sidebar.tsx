/**
 * Sidebar - Main navigation sidebar component
 * Provides navigation between app routes and displays active project info
 */

import { NAV_ITEMS } from './navItems';
import type { SidebarProps } from './navItems';
import './Sidebar.css';

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
