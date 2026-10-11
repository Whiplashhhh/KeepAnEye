import type { HostInfo, LiveMessage, SessionInfo } from '@kae/shared';
import { WebSocket } from 'ws';
import type { HostStats } from '../host/stats.js';
import type { SessionService } from '../sessions.js';

export interface HubOptions {
  sessionsIntervalMs?: number;
  hostIntervalMs?: number;
}

/** Pushes live dashboard state to every connected /ws/live client. Polls only while someone is watching. */
export class LiveHub {
  private readonly clients = new Set<WebSocket>();
  private sessionsTimer: NodeJS.Timeout | null = null;
  private hostTimer: NodeJS.Timeout | null = null;
  private lastSessions = '';
  private lastSessionsData: SessionInfo[] = [];
  private lastHost: HostInfo | null = null;
  private refreshing: Promise<void> | null = null;
  private refreshQueued = false;

  constructor(
    private readonly sessions: SessionService,
    private readonly host: HostStats,
    private readonly opts: HubOptions = {},
  ) {}

  add(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) this.stopLoops();
    });
    if (this.lastSessions) this.sendTo(ws, { type: 'sessions', sessions: this.lastSessionsData });
    if (this.lastHost) this.sendTo(ws, { type: 'host', host: this.lastHost });
    this.startLoops();
    void this.refreshSessions(true);
  }

  get size(): number {
    return this.clients.size;
  }

  broadcast(msg: LiveMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }

  /** Recomputes the session list; broadcasts if it changed (or always when `force`). Coalesces concurrent calls. */
  refreshSessions(force = false): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      try {
        const list = await this.sessions.list();
        const json = JSON.stringify(list);
        if (force || json !== this.lastSessions) {
          this.lastSessions = json;
          this.lastSessionsData = list;
          this.broadcast({ type: 'sessions', sessions: list });
        }
      } catch {
        // tmux hiccup: keep the last known state
      } finally {
        this.refreshing = null;
        if (this.refreshQueued) {
          this.refreshQueued = false;
          void this.refreshSessions();
        }
      }
    })();
    return this.refreshing;
  }

  private async refreshHost(): Promise<void> {
    try {
      this.lastHost = await this.host.read();
      this.broadcast({ type: 'host', host: this.lastHost });
    } catch {
      // ignore
    }
  }

  private startLoops(): void {
    if (!this.sessionsTimer) {
      this.sessionsTimer = setInterval(() => void this.refreshSessions(), this.opts.sessionsIntervalMs ?? 2000);
    }
    if (!this.hostTimer) {
      void this.refreshHost();
      this.hostTimer = setInterval(() => void this.refreshHost(), this.opts.hostIntervalMs ?? 5000);
    }
  }

  private stopLoops(): void {
    if (this.sessionsTimer) clearInterval(this.sessionsTimer);
    if (this.hostTimer) clearInterval(this.hostTimer);
    this.sessionsTimer = null;
    this.hostTimer = null;
  }

  closeAll(code = 4401, reason = 'session'): void {
    for (const ws of this.clients) {
      this.sendTo(ws, { type: 'bye', reason });
      ws.close(code, reason);
    }
  }

  stop(): void {
    this.stopLoops();
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
  }

  private sendTo(ws: WebSocket, msg: LiveMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}
