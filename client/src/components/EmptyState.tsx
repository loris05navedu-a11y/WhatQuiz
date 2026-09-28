import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({ icon, title, children, actions }: { icon: IconName; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty-state animate-in">
      <div className="empty-state-icon">
        <Icon name={icon} size={30} />
      </div>
      <h2 style={{ fontSize: '1.25rem' }}>{title}</h2>
      {children && <p className="muted" style={{ maxWidth: 420 }}>{children}</p>}
      {actions && <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>{actions}</div>}
    </div>
  );
}
