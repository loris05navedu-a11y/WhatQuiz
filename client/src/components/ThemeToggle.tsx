import { useTheme } from '../context/ThemeContext';
import { Button } from './Button';

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const label = resolved === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre';
  return <Button variant="ghost" icon={resolved === 'dark' ? 'sun' : 'moon'} onClick={toggle} aria-label={label} title={label} className={className} />;
}
