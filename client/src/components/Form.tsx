import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { IconName } from './Icon';
import { Icon } from './Icon';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
  hideLabel?: boolean;
}

/** Associe proprement libellé, aide et message d'erreur à un champ (accessibilité). */
export function Field({ label, hint, error, children, hideLabel }: FieldProps) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'field-label'}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  icon?: IconName;
  hideLabel?: boolean;
}

export function TextField({ label, hint, error, icon, hideLabel, className, ...rest }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel}>
      {(a11y) =>
        icon ? (
          <div className="input-with-icon">
            <Icon name={icon} />
            <input className={`input ${className ?? ''}`} {...a11y} {...rest} />
          </div>
        ) : (
          <input className={`input ${className ?? ''}`} {...a11y} {...rest} />
        )
      }
    </Field>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  hideLabel?: boolean;
}

export function TextAreaField({ label, hint, error, hideLabel, className, ...rest }: TextAreaFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel}>
      {(a11y) => <textarea className={`textarea ${className ?? ''}`} {...a11y} {...rest} />}
    </Field>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  hideLabel?: boolean;
  options: { value: string; label: string }[];
}

export function SelectField({ label, hint, hideLabel, options, className, ...rest }: SelectFieldProps) {
  return (
    <Field label={label} hint={hint} hideLabel={hideLabel}>
      {(a11y) => (
        <select className={`select ${className ?? ''}`} {...a11y} {...rest}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

interface SwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, description, checked, onChange, disabled }: SwitchProps) {
  return (
    <label className="switch" style={disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
      <span className="switch-text">
        <span style={{ fontWeight: 600 }}>{label}</span>
        {description && <span className="field-hint">{description}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string | number>({ label, value, options, onChange, className = 'segmented' }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={className}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={className === 'chips' ? 'chip' : undefined}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} size={18} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
