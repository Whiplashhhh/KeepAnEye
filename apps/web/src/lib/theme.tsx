import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePref = 'system' | 'dark' | 'light';
const KEY = 'kae.theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    // storage unavailable
  }
  return 'system';
}

function resolve(pref: ThemePref): 'dark' | 'light' {
  return pref === 'dark' || (pref === 'system' && !window.matchMedia('(prefers-color-scheme: light)').matches)
    ? 'dark'
    : 'light';
}

interface ThemeCtx {
  pref: ThemePref;
  resolved: 'dark' | 'light';
  setPref: (p: ThemePref) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => resolve(readPref()));

  useEffect(() => {
    const applyNow = () => {
      const r = resolve(pref);
      document.documentElement.dataset.theme = r;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', r === 'dark' ? '#0d1017' : '#f6f7f9');
      setResolved(r);
    };
    applyNow();
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', applyNow);
    return () => mq.removeEventListener('change', applyNow);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    try {
      localStorage.setItem(KEY, p);
    } catch {
      // ignore
    }
    setPrefState(p);
  }, []);

  const toggle = useCallback(() => setPref(resolved === 'dark' ? 'light' : 'dark'), [resolved, setPref]);
  const value = useMemo(() => ({ pref, resolved, setPref, toggle }), [pref, resolved, setPref, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}
