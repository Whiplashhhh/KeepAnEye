import type { AttachCommand, NewSessionOptions, TmuxClient, TmuxSession } from './client.js';
import { TmuxError } from './client.js';

/** In-memory tmux used by tests where a real tmux server is not wanted. */
export class FakeTmuxClient implements TmuxClient {
  readonly sessions = new Map<string, TmuxSession & { lines: string[]; opts?: NewSessionOptions }>();
  readonly created: { name: string; opts: NewSessionOptions }[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  async listSessions(): Promise<TmuxSession[]> {
    return [...this.sessions.values()].map(({ lines: _l, opts: _o, ...s }) => ({ ...s, windows: [...s.windows] }));
  }

  async hasSession(name: string): Promise<boolean> {
    return this.sessions.has(name);
  }

  async capturePane(name: string, lines: number): Promise<string[]> {
    const s = this.sessions.get(name);
    if (!s) throw new TmuxError(`can't find session: ${name}`);
    return s.lines.slice(-lines);
  }

  async newSession(name: string, opts: NewSessionOptions): Promise<void> {
    if (this.sessions.has(name)) throw new TmuxError(`duplicate session: ${name}`);
    const t = this.now();
    this.created.push({ name, opts });
    this.sessions.set(name, {
      name,
      createdAt: t,
      activityAt: t,
      attached: 0,
      kind: opts.userOptions?.['@kae_kind'] ?? null,
      project: opts.userOptions?.['@kae_project'] ?? null,
      template: opts.userOptions?.['@kae_template'] ?? null,
      windows: [{ index: 0, name: opts.command[0] ?? 'bash', active: true, command: opts.command[0] ?? 'bash', path: opts.cwd }],
      deadStatus: null,
      lines: [],
      opts,
    });
  }

  async killSession(name: string): Promise<void> {
    if (!this.sessions.delete(name)) throw new TmuxError(`can't find session: ${name}`);
  }

  attachCommand(_name: string): AttachCommand {
    return { file: 'cat', args: [] };
  }

  /** Test helper: simulate output in a session. */
  write(name: string, ...lines: string[]): void {
    const s = this.sessions.get(name);
    if (!s) throw new Error(`no session ${name}`);
    s.lines.push(...lines);
    s.activityAt = this.now();
  }
}
