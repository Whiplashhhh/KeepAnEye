import { EventEmitter } from 'node:events';
import type { ActivityItem, ClaudeStatus } from '@kae/shared';
import type { DB } from '../db.js';
import type { ClaudeEvent } from './events.js';
import type { ClaudeState } from './status.js';
import { forgetHooked } from './pane.js';
import { applyEvent } from './status.js';

export interface StatusChange {
  session: string;
  from: ClaudeStatus | null;
  to: ClaudeStatus;
  state: ClaudeState;
  event: ClaudeEvent;
  activity: ActivityItem | null;
}

interface Row {
  session: string;
  status: ClaudeStatus;
  claude_session_id: string | null;
  cwd: string | null;
  transcript_path: string | null;
  last_event: string | null;
  last_message: string | null;
  updated_at: number;
}

const MAX_ACTIVITY_ROWS = 5000;

/** Persists per-session Claude state and the activity feed; emits `change` on every applied event. */
export class ClaudeTracker extends EventEmitter<{ change: [StatusChange] }> {
  constructor(private readonly db: DB) {
    super();
  }

  get(session: string): ClaudeState | null {
    const r = this.db.prepare('SELECT * FROM claude_state WHERE session = ?').get(session) as Row | undefined;
    return r ? fromRow(r) : null;
  }

  all(): Map<string, ClaudeState> {
    const rows = this.db.prepare('SELECT * FROM claude_state').all() as Row[];
    return new Map(rows.map((r) => [r.session, fromRow(r)]));
  }

  /** Forget a session's state (a new tmux session reusing the name starts fresh). */
  reset(session: string): void {
    this.db.prepare('DELETE FROM claude_state WHERE session = ?').run(session);
    forgetHooked(this.db, session);
  }

  apply(ev: ClaudeEvent): StatusChange {
    const prev = this.get(ev.session);
    const t = applyEvent(prev, ev);
    const s = t.state;
    this.db
      .prepare(
        `INSERT INTO claude_state (session, status, claude_session_id, cwd, transcript_path, last_event, last_message, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session) DO UPDATE SET status = excluded.status, claude_session_id = excluded.claude_session_id,
           cwd = excluded.cwd, transcript_path = excluded.transcript_path, last_event = excluded.last_event,
           last_message = excluded.last_message, updated_at = excluded.updated_at`,
      )
      .run(s.session, s.status, s.claudeSessionId, s.cwd, s.transcriptPath, s.lastEvent, s.lastMessage, s.updatedAt);
    let activity: ActivityItem | null = null;
    if (t.activity) {
      const res = this.db
        .prepare('INSERT INTO activity (ts, session, status, text) VALUES (?, ?, ?, ?)')
        .run(ev.ts, s.session, s.status, t.activity);
      activity = { id: Number(res.lastInsertRowid), ts: ev.ts, session: s.session, status: s.status, text: t.activity };
    }
    const change: StatusChange = { session: s.session, from: prev?.status ?? null, to: s.status, state: s, event: ev, activity };
    this.emit('change', change);
    return change;
  }

  activity(limit = 100, before?: number): ActivityItem[] {
    const rows = (
      before
        ? this.db
            .prepare(
              `SELECT * FROM activity WHERE (ts, id) < (SELECT ts, id FROM activity WHERE id = ?) ORDER BY ts DESC, id DESC LIMIT ?`,
            )
            .all(before, limit)
        : this.db.prepare('SELECT * FROM activity ORDER BY ts DESC, id DESC LIMIT ?').all(limit)
    ) as ActivityItem[];
    return rows.map((r) => ({ id: r.id, ts: r.ts, session: r.session, status: r.status, text: r.text }));
  }

  prune(): void {
    this.db.prepare('DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - ?').run(MAX_ACTIVITY_ROWS);
  }
}

function fromRow(r: Row): ClaudeState {
  return {
    session: r.session,
    status: r.status,
    claudeSessionId: r.claude_session_id,
    cwd: r.cwd,
    transcriptPath: r.transcript_path,
    lastEvent: r.last_event,
    lastMessage: r.last_message,
    updatedAt: r.updated_at,
  };
}
