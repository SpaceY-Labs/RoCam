/**
 * ProjectPreview - Live preview of project being created
 * Shows name, description, and labels
 */

import type { Label } from '../../../types';
import { Card } from '../../../components/ui';

// ============ Types ============
export interface ProjectPreviewProps {
  /** Project name */
  name: string;
  /** Project description */
  description: string;
  /** List of labels */
  labels: Label[];
}

// ============ Component ============
export function ProjectPreview({ name, description, labels }: ProjectPreviewProps) {
  return (
    <div className="create-project-preview">
      <Card variant="bordered" padding="medium">
        <h4 className="preview-title">Preview</h4>
        <div className="preview-content">
          {/* Project Name */}
          <div className="preview-name">{name || 'Project Name'}</div>

          {/* Project Description */}
          <div className="preview-desc">
            {description || 'Project description will appear here.'}
          </div>

          {/* Labels */}
          <div className="preview-classes">
            <span className="preview-label">Labels ({labels.length}):</span>
            {labels.length === 0 ? (
              <span className="muted">No labels added yet</span>
            ) : (
              <div className="preview-class-list">
                {labels.map((label) => (
                  <span
                    key={label.labelId}
                    className="preview-class"
                    style={{ borderColor: label.color }}
                  >
                    <span
                      className="preview-class-dot"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

export default ProjectPreview;
