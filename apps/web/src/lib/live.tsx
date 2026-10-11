import type { ActivityItem, HostInfo, LiveMessage, SessionInfo } from '@kae/shared';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

export type LinkState = 'connecting' | 'open' | 'reconnecting';

interface LiveCtx {
  sessions: SessionInfo[] | null;
  host: HostInfo | null;
  /** Activity items received live since the app opened (newest first). */
  liveActivity: ActivityItem[];
  link: LinkState;
  refresh: () => Promise<void>;
}

const Ctx = createContext<LiveCtx | null>(null);

export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

export function LiveProvider({ children, onExpired }: { children: ReactNode; onExpired: () => void }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [host, setHost] = useState<HostInfo | null>(null);
  const [liveActivity, setLiveActivity] = useState<ActivityItem[]>([]);
  const [link, setLink] = useState<LinkState>('connecting');
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: number | undefined;
    let stopped = false;

    const connect = () => {
      ws = new WebSocket(wsUrl('/ws/live'));
      ws.onopen = () => {
        retry = 0;
        setLink('open');
      };
      ws.onmessage = (e) => {
        let msg: LiveMessage;
        try {
          msg = JSON.parse(String(e.data)) as LiveMessage;
        } catch {
          return;
        }
        if (msg.type === 'sessions') setSessions(msg.sessions);
        else if (msg.type === 'host') setHost(msg.host);
        else if (msg.type === 'activity') setLiveActivity((a) => [msg.item, ...a].slice(0, 200));
        else if (msg.type === 'bye') {
          stopped = true;
          expiredRef.current();
        }
      };
      ws.onclose = (e) => {
        if (stopped) return;
        if (e.code === 4401) {
          expiredRef.current();
          return;
        }
        setLink('reconnecting');
        // The upgrade is refused with 401 when the session expired: check before retrying forever.
        void api('/api/auth/me')
          .then((me) => {
            if (!(me as { authenticated: boolean }).authenticated) expiredRef.current();
          })
          .catch(() => undefined);
        const delay = Math.min(10_000, 500 * 2 ** retry++);
        timer = window.setTimeout(connect, delay);
      };
    };
    connect();

    const onVisible = () => {
      // Phones freeze background tabs: reconnect at once when coming back.
      if (document.visibilityState === 'visible' && ws && ws.readyState === WebSocket.CLOSED) {
        window.clearTimeout(timer);
        retry = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      ws?.close();
    };
  }, []);

  const value = useMemo<LiveCtx>(
    () => ({
      sessions,
      host,
      liveActivity,
      link,
      refresh: async () => {
        const r = await api<{ sessions: SessionInfo[] }>('/api/sessions');
        setSessions(r.sessions);
      },
    }),
    [sessions, host, liveActivity, link],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive(): LiveCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLive outside LiveProvider');
  return c;
}
