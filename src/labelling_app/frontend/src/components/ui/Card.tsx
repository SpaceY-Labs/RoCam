import type { CSSProperties, ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  variant?: 'default' | 'bordered' | 'elevated';
  padding?: 'none' | 'small' | 'medium' | 'large';
  style?: CSSProperties;
}

export function Card({
  children,
  className = '',
  onClick,
  active = false,
  variant = 'default',
  padding = 'medium',
  style,
}: CardProps) {
  const classes = [
    'card',
    `card-${variant}`,
    `card-p-${padding}`,
    active ? 'card-active' : '',
    onClick ? 'card-clickable' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} onClick={onClick} style={style}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  trend,
  className = '',
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: { value: number; label: string };
  className?: string;
}) {
  return (
    <Card className={`stat-card ${className}`} variant="bordered">
      <div className="stat-header">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {trend && (
        <div className={`stat-trend ${trend.value >= 0 ? 'positive' : 'negative'}`}>
          <span>{trend.value >= 0 ? '+' : ''}{trend.value}%</span>
          <span className="trend-label">{trend.label}</span>
        </div>
      )}
    </Card>
  );
}
