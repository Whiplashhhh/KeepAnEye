import { useCallback, useState } from 'react';

const KEY = 'kae.sidebar';

/** Desktop sidebar folded into a narrow rail, remembered per browser. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        if (next) localStorage.setItem(KEY, 'collapsed');
        else localStorage.removeItem(KEY);
      } catch {
        // storage unavailable
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}
