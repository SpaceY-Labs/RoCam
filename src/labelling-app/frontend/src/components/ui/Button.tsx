/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Reusable button UI component with variant, size, and loading state support.
 */
import type { ButtonProps } from '../../types';
import './Button.css';

export function Button({
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    `btn-${size}`,
    loading ? 'btn-loading' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="btn-spinner" />}
      <span className={loading ? 'btn-text-loading' : ''}>{children}</span>
    </button>
  );
}
