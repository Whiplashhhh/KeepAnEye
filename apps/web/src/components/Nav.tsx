import type { LucideIcon } from 'lucide-react';
import { Activity, LayoutList, Settings } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cx } from './ui';

const ITEMS: { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean }[] = [
  { href: '/', label: 'Sessions', icon: LayoutList, match: (p) => p === '/' || p.startsWith('/s/') },
  { href: '/activity', label: 'Activité', icon: Activity, match: (p) => p.startsWith('/activity') },
  { href: '/settings', label: 'Réglages', icon: Settings, match: (p) => p.startsWith('/settings') },
];

export function BottomNav({ badge }: { badge: number }) {
  const [path] = useLocation();
  return (
    <nav
      aria-label="Navigation principale"
      // The after: strip extends the bar below the screen edge: an installed iOS PWA can lay out a
      // short (non-scrolling) page above the bottom safe area, which left the bar floating over a gap.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-elevated/90 backdrop-blur-lg safe-bottom after:absolute after:inset-x-0 after:top-full after:h-24 after:bg-elevated/90 lg:hidden"
    >
      <ul className="mx-auto flex max-w-md">
        {ITEMS.map((it) => {
          const active = it.match(path);
          const Icon = it.icon;
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  active ? 'text-fg' : 'text-faint hover:text-muted',
                )}
              >
                <span className="relative">
                  <Icon className={cx('size-[22px]', active && 'text-accent')} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                  {it.href === '/' && badge > 0 && (
                    <span className="tabular absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-waiting px-1 text-[10px] font-bold text-[#1a1203] ring-2 ring-elevated">
                      {badge}
                      <span className="sr-only"> session(s) t’attendent</span>
                    </span>
                  )}
                </span>
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideNav() {
  const [path] = useLocation();
  return (
    <nav aria-label="Navigation principale" className="flex gap-1">
      {ITEMS.map((it) => {
        const active = it.match(path);
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-[13px] font-medium transition-colors',
              active ? 'bg-surface-2 text-fg' : 'text-faint hover:bg-surface-2/60 hover:text-muted',
            )}
          >
            <Icon className={cx('size-4', active && 'text-accent')} aria-hidden />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
