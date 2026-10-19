import type { ClaudeStatus } from '@kae/shared';
import type { DB } from '../db.js';
import { kvGet, kvSet } from '../db.js';
import type { TmuxClient } from '../tmux/client.js';
import type { ClaudeEvent } from './events.js';
import type { ClaudeTracker } from './tracker.js';

/**
 * Fallback for sessions whose hooks never report (not installed, events file unreachable, session started
 * before the install): the status is read from the Claude Code TUI in the tmux pane and fed to the tracker as
 * ordinary events, so the activity feed and push notifications keep working. As soon as one real hook event
 * arrives for a session, the pane is no longer consulted for it.
 */

// Generous: on a narrow (phone) terminal the prompt box, footer and todo list wrap and push the spinner up.
const TAIL_LINES = 24;
const BUSY = /esc to interrupt/i;
// The spinner line itself ("✻ Thinking… (3s · esc to interrupt)"): on a narrow terminal Claude Code drops the
// "esc to interrupt" hint, so the glyph + "Verb…" is what remains. The finished line ("✻ Worked for 3s") has no "…".
const SPINNER = /^\s*[·✢✳✶✻✽*]\s+\S[^…]{0,40}…(?:\s|\(|$)/u;
// Choice dialogs (permissions, questions): a numbered list with a ❯ cursor on one option, an editable
// "Type something" option, and an "Esc to cancel" footer. The first option is not always "Yes".
const OPTION = /^[\s│┃]*[❯>]?\s*\d+\.\s+\S/;
const CURSOR = /^[\s│┃]*[❯>]\s*\d+\.\s+\S/;
// Only real dialog lines count: the conversation itself may well quote these words (a bullet, a quote…).
const TYPE_SOMETHING = /^[\s│┃]*[❯>]?\s*\d+\.\s+type something/i;
const CANCEL = /^[\s│┃]*(enter to select|esc to cancel)\b/i;

export interface PaneReading {
  busy: boolean;
  /** Set when a dialog is waiting for the user: its question (or a generic text). */
  waiting: string | null;
}

export function readPane(lines: string[]): PaneReading {
  const tail = lines.filter((l) => l.trim() !== '').slice(-TAIL_LINES);
  // The hint may also be wrapped over two lines ("esc to" / "interrupt)").
  const busy = tail.some((l) => SPINNER.test(l)) || BUSY.test(tail.join(' ').replace(/\s+/g, ' '));
  if (busy) return { busy: true, waiting: null };
  const options = tail.filter((l) => OPTION.test(l)).length;
  const dialog =
    tail.some((l) => CANCEL.test(l) || TYPE_SOMETHING.test(l)) || (options >= 2 && tail.some((l) => CURSOR.test(l)));
  if (!dialog) return { busy: false, waiting: null };
  const first = tail.findIndex((l) => OPTION.test(l));
  const before = first < 0 ? tail : tail.slice(0, first);
  const q = before
    .map((l) => l.replace(/^[\s│┃]+|[\s│┃]+$/g, ''))
    .filter((l) => l.endsWith('?'))
    .pop();
  return { busy: false, waiting: q ?? 'Claude attend ta réponse' };
}

const hookedKey = (session: string) => `hooked:${session}`;

export function markHooked(db: DB, session: string): void {
  if (!kvGet(db, hookedKey(session))) kvSet(db, hookedKey(session), true);
}

export function forgetHooked(db: DB, session: string): void {
  db.prepare('DELETE FROM kv WHERE key = ?').run(hookedKey(session));
}

/** Not-busy readings needed in a row before a working session is declared done (the spinner can blink off). */
const DONE_AFTER = 2;

export class PaneMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly quiet = new Map<string, number>();

  constructor(
    private readonly db: DB,
    private readonly tmux: TmuxClient,
    private readonly tracker: ClaudeTracker,
    private readonly opts: { pollMs?: number; now?: () => number } = {},
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? 2000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over the Claude sessions (public for tests). Never throws. */
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sessions = await this.tmux.listSessions();
      const live = new Set<string>();
      for (const s of sessions) {
        if (s.kind !== 'claude' || s.deadStatus !== null) continue;
        live.add(s.name);
        if (kvGet(this.db, hookedKey(s.name))) continue;
        let lines: string[];
        try {
          lines = await this.tmux.capturePane(s.name, 60);
        } catch {
          continue;
        }
        this.step(s.name, readPane(lines));
      }
      for (const name of this.quiet.keys()) if (!live.has(name)) this.quiet.delete(name);
    } catch {
      // tmux hiccup: try again next tick
    } finally {
      this.running = false;
    }
  }

  private step(session: string, r: PaneReading): void {
    const prev: ClaudeStatus = this.tracker.get(session)?.status ?? 'idle';
    let hook: ClaudeEvent['hook'] | null = null;
    let message: string | null = null;
    if (r.waiting) {
      this.quiet.delete(session);
      if (prev !== 'waiting') {
        hook = 'Notification';
        message = r.waiting;
      }
    } else if (r.busy) {
      this.quiet.delete(session);
      if (prev === 'idle' || prev === 'done' || prev === 'error') hook = 'UserPromptSubmit';
      else if (prev === 'waiting') hook = 'PreToolUse';
    } else if (prev === 'working' || prev === 'waiting') {
      const n = (this.quiet.get(session) ?? 0) + 1;
      this.quiet.set(session, n);
      if (n >= DONE_AFTER) {
        this.quiet.delete(session);
        hook = 'Stop';
      }
    }
    if (!hook) return;
    this.tracker.apply({
      session,
      hook,
      ts: (this.opts.now ?? Date.now)(),
      claudeSessionId: null,
      transcriptPath: null,
      cwd: null,
      prompt: null,
      toolName: null,
      toolSummary: null,
      message,
      notificationType: null,
      reason: null,
    });
  }
}
