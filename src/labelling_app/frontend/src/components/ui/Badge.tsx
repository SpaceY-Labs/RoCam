import type { CSSProperties, ReactNode } from 'react';
import type { ImageStatus } from '../../types';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  size?: 'small' | 'medium';
  className?: string;
}

export function Badge({
  children,
  variant = 'default',
  size = 'medium',
  className = '',
}: BadgeProps) {
  return (
    <span className={`badge badge-${variant} badge-${size} ${className}`}>
      {children}
    </span>
  );
}

export function ClassBadge({
  name,
  color,
  onRemove,
  className = '',
}: {
  name: string;
  color: string;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={`class-badge ${className}`}
      style={{ '--badge-color': color } as CSSProperties}
    >
      <span className="class-badge-dot" />
      <span className="class-badge-name">{name}</span>
      {onRemove && (
        <button className="class-badge-remove" onClick={onRemove} aria-label={`Remove ${name}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}

export function StatusBadge({ status }: { status: ImageStatus }) {
  const config: Record<ImageStatus, { label: string; variant: BadgeProps['variant'] }> = {
    unlabeled: { label: 'Unlabeled', variant: 'warning' },
    in_progress: { label: 'In Progress', variant: 'info' },
    labeled: { label: 'Labeled', variant: 'success' },
  };

  const { label, variant } = config[status];

  return <Badge variant={variant}>{label}</Badge>;
}

export function TagBadge({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className="tag-badge">
      {tag}
      {onRemove && (
        <button className="tag-badge-remove" onClick={onRemove} aria-label={`Remove ${tag}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}
