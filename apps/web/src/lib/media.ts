import { useEffect, useState } from 'react';

const DESKTOP = '(min-width: 1024px)';

/** True on screens wide enough for the sidebar layout (Tailwind's `lg`). */
export function useIsDesktop(): boolean {
  const [d, setD] = useState(() => window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const on = () => setD(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return d;
}
