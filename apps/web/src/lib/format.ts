const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto', style: 'short' });

/** "à l'instant", "il y a 5 min", "il y a 3 h"… */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return rtf.format(-m, 'minute');
  const h = Math.round(m / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  const d = Math.round(h / 24);
  return rtf.format(-d, 'day');
}

/** Compact duration: "42 s", "12 min", "3 h 05", "2 j 4 h". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  const d = Math.floor(h / 24);
  return `${d} j ${h % 24} h`;
}

export function bytes(n: number): string {
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(0)} Mo`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} Go`;
  return `${(n / 1024 ** 4).toFixed(2).replace('.', ',')} To`;
}

export function percent(x: number): string {
  return `${Math.round(x * 100)} %`;
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Aujourd'hui";
  if (same(d, yesterday)) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function suggestName(existing: string[], base = 'session'): string {
  for (let i = 1; i < 1000; i++) {
    const n = `${base}-${i}`;
    if (!existing.includes(n)) return n;
  }
  return `${base}-${Date.now() % 10000}`;
}
