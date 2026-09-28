import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'soft';
type Size = 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
  children?: ReactNode;
  className?: string;
}

function classes({ variant = 'secondary', size = 'md', block, className, children }: CommonProps & { children?: ReactNode }) {
  return [
    'btn',
    variant !== 'secondary' && `btn-${variant}`,
    size !== 'md' && `btn-${size}`,
    block && 'btn-block',
    !children && 'btn-icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

const iconSize = (size: Size = 'md') => (size === 'lg' ? 22 : size === 'sm' ? 16 : 20);

interface ButtonProps extends CommonProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  loading?: boolean;
}

export function Button({ variant, size, icon, iconRight, block, loading, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={classes({ variant, size, block, className, children })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={iconSize(size)} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize(size)} />}
    </button>
  );
}

interface LinkButtonProps extends CommonProps {
  to: string;
  state?: unknown;
  'aria-label'?: string;
  title?: string;
}

export function LinkButton({ to, state, variant, size, icon, iconRight, block, children, className, ...rest }: LinkButtonProps) {
  return (
    <Link to={to} state={state} className={classes({ variant, size, block, className, children })} {...rest}>
      {icon && <Icon name={icon} size={iconSize(size)} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize(size)} />}
    </Link>
  );
}

export function Spinner({ large = false, label = 'Chargement…' }: { large?: boolean; label?: string }) {
  return (
    <span role="status" className={`spinner${large ? ' spinner-lg' : ''}`}>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageLoader() {
  return (
    <div className="page-loader">
      <Spinner large />
    </div>
  );
}
