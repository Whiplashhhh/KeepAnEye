import { useEffect, useState } from 'react';

// Temporary diagnostic for the bottom nav floating above the screen edge in the installed iOS PWA.
// Toggled from Settings; remove once that bug is understood.

const KEY = 'kae.viewportProbe';
const EVENT = 'kae-viewport-probe';

export function viewportProbeEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setViewportProbe(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  document.dispatchEvent(new Event(EVENT));
}

function safeArea(): { top: number; bottom: number } {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const r = { top: parseFloat(cs.paddingTop), bottom: parseFloat(cs.paddingBottom) };
  el.remove();
  return r;
}

function measure(): string[] {
  const d = document.documentElement;
  const vv = window.visualViewport;
  const nav = document.querySelector('nav[aria-label="Navigation principale"]')?.getBoundingClientRect();
  const sa = safeArea();
  const r = (n: number | undefined) => (n === undefined ? '-' : String(Math.round(n * 10) / 10));
  return [
    `screen ${screen.width}x${screen.height} standalone=${matchMedia('(display-mode: standalone)').matches}`,
    `inner ${innerWidth}x${innerHeight} outerH ${outerHeight}`,
    `client ${d.clientWidth}x${d.clientHeight} scrollH ${d.scrollHeight} scrollY ${r(scrollY)}`,
    `vv h ${r(vv?.height)} top ${r(vv?.offsetTop)} pageTop ${r(vv?.pageTop)}`,
    `safe top ${sa.top} bottom ${sa.bottom}`,
    `nav top ${r(nav?.top)} bottom ${r(nav?.bottom)} h ${r(nav?.height)}`,
  ];
}

export function ViewportProbe() {
  const [on, setOn] = useState(viewportProbeEnabled);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => setOn(viewportProbeEnabled());
    document.addEventListener(EVENT, sync);
    return () => document.removeEventListener(EVENT, sync);
  }, []);

  useEffect(() => {
    if (!on) return;
    const update = () => setLines(measure());
    update();
    const id = window.setInterval(update, 500);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [on]);

  if (!on) return null;
  return (
    <>
      <pre className="pointer-events-none fixed inset-x-2 top-[calc(4px+env(safe-area-inset-top))] z-[70] whitespace-pre-wrap rounded-md bg-black/85 p-2 font-mono text-[11px] leading-snug text-[#7CFC9A]">
        {lines.join('\n')}
      </pre>
      {/* Red line on the bottom edge of the layout viewport, where bottom-0 puts the nav. */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] h-px bg-[#ff3b30]" />
    </>
  );
}
