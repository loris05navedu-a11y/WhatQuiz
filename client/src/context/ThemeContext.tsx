import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { readStorage, writeStorage } from '../lib/storage';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeApi {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference(preference: ThemePreference): void;
  toggle(): void;
}

const ThemeContext = createContext<ThemeApi | null>(null);
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPreference(): ThemePreference {
  const stored = readStorage('local', 'wq:theme');
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const query = media();
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') delete root.dataset.theme;
    else root.dataset.theme = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#100e1d' : '#5b3df5');
  }, [preference, resolved]);

  const setPreference = useCallback((value: ThemePreference) => {
    writeStorage('local', 'wq:theme', value === 'system' ? null : value);
    setPreferenceState(value);
  }, []);

  const toggle = useCallback(() => setPreference(resolved === 'dark' ? 'light' : 'dark'), [resolved, setPreference]);

  return <ThemeContext.Provider value={{ preference, resolved, setPreference, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme doit être utilisé dans <ThemeProvider>');
  return context;
}
