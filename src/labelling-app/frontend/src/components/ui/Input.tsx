/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Reusable form input UI components including text input, select, color picker, and textarea.
 */
import { useId } from 'react';
import type { InputProps, SelectProps, TextAreaProps } from '../../types';
import './Input.css';

export function Input({
  label,
  error,
  helperText,
  className = '',
  id,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={`input-group ${error ? 'input-error' : ''} ${className}`}>
      {label && <label htmlFor={inputId}>{label}</label>}
      <input id={inputId} {...props} />
      {error && <span className="input-error-text">{error}</span>}
      {helperText && !error && <span className="input-helper">{helperText}</span>}
    </div>
  );
}

export function Select({
  label,
  error,
  options,
  className = '',
  id,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className={`input-group ${error ? 'input-error' : ''} ${className}`}>
      {label && <label htmlFor={selectId}>{label}</label>}
      <select id={selectId} {...props}>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <span className="input-error-text">{error}</span>}
    </div>
  );
}

export function ColorInput({
  label,
  value,
  onChange,
  className = '',
}: {
  label?: string;
  value: string;
  onChange: (color: string) => void;
  className?: string;
}) {
  return (
    <div className={`input-group color-input-group ${className}`}>
      {label && <label>{label}</label>}
      <div className="color-input-wrapper">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="color-value">{value.toUpperCase()}</span>
      </div>
    </div>
  );
}

export function TextArea({
  label,
  error,
  helperText,
  className = '',
  id,
  rows = 3,
  ...props
}: TextAreaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;

  return (
    <div className={`input-group ${error ? 'input-error' : ''} ${className}`}>
      {label && <label htmlFor={textareaId}>{label}</label>}
      <textarea id={textareaId} rows={rows} {...props} />
      {error && <span className="input-error-text">{error}</span>}
      {helperText && !error && <span className="input-helper">{helperText}</span>}
    </div>
  );
}
