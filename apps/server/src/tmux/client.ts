import { execFile } from 'node:child_process';
import type { WindowInfo } from '@kae/shared';

export interface TmuxSession {
  name: string;
  createdAt: number;
  activityAt: number;
  attached: number;
  kind: string | null;
  project: string | null;
  template: string | null;
  windows: WindowInfo[];
  /** Exit status of the active pane when its process has ended (remain-on-exit), else null. */
  deadStatus: number | null;
}

export interface NewSessionOptions {
  cwd: string;
  /** argv; empty = the user's default shell. Never interpreted by a shell. */
  command: string[];
  env?: Record<string, string>;
  /** tmux user options to set on the session (keys must start with @). */
  userOptions?: Record<string, string>;
  /** Keep the pane (and its output) when the command fails, instead of closing the session. */
  keepOnFailure?: boolean;
}

export interface AttachCommand {
  file: string;
  args: string[];
}

/** Everything the app needs from tmux. The real implementation shells out with execFile, never a shell. */
export interface TmuxClient {
  listSessions(): Promise<TmuxSession[]>;
  hasSession(name: string): Promise<boolean>;
  capturePane(name: string, lines: number): Promise<string[]>;
  newSession(name: string, opts: NewSessionOptions): Promise<void>;
  killSession(name: string): Promise<void>;
  attachCommand(name: string): AttachCommand;
}

// tmux replaces control characters in format output, so use a printable, improbable separator.
const SEP = '::kae::';

const SESSION_FORMAT = [
  '#{session_name}',
  '#{session_created}',
  '#{session_activity}',
  '#{session_attached}',
  '#{@kae_kind}',
  '#{@kae_project}',
  '#{@kae_template}',
].join(SEP);

const WINDOW_FORMAT = [
  '#{session_name}',
  '#{window_index}',
  '#{window_name}',
  '#{window_active}',
  '#{pane_current_command}',
  '#{pane_current_path}',
  '#{pane_dead}',
  '#{pane_dead_status}',
].join(SEP);

const NO_SERVER = /no server running|error connecting to|no sessions/i;

export class TmuxError extends Error {}

export class RealTmuxClient implements TmuxClient {
  constructor(
    private readonly bin = 'tmux',
    private readonly socket?: string,
  ) {}

  private baseArgs(): string[] {
    return this.socket ? ['-L', this.socket] : [];
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.bin,
        [...this.baseArgs(), ...args],
        { timeout: 5000, maxBuffer: 4 * 1024 * 1024, env: tmuxEnv() },
        (err, stdout, stderr) => {
          if (err) reject(new TmuxError(String(stderr || err.message).trim()));
          else resolve(stdout);
        },
      );
    });
  }

  async listSessions(): Promise<TmuxSession[]> {
    let sessionsOut: string;
    let windowsOut: string;
    try {
      [sessionsOut, windowsOut] = await Promise.all([
        this.run(['list-sessions', '-F', SESSION_FORMAT]),
        this.run(['list-windows', '-a', '-F', WINDOW_FORMAT]),
      ]);
    } catch (e) {
      if (e instanceof TmuxError && NO_SERVER.test(e.message)) return [];
      throw e;
    }
    const sessions = new Map<string, TmuxSession>();
    for (const line of sessionsOut.split('\n')) {
      if (!line) continue;
      const [name, created, activity, attached, kind, project, template] = line.split(SEP);
      if (name === undefined) continue;
      sessions.set(name, {
        name,
        createdAt: Number(created) * 1000,
        activityAt: Number(activity) * 1000,
        attached: Number(attached) || 0,
        kind: kind || null,
        project: project || null,
        template: template || null,
        windows: [],
        deadStatus: null,
      });
    }
    for (const line of windowsOut.split('\n')) {
      if (!line) continue;
      const [sname, index, wname, active, command, cwd, dead, deadStatus] = line.split(SEP);
      const s = sname !== undefined ? sessions.get(sname) : undefined;
      if (!s) continue;
      const isActive = active === '1';
      s.windows.push({ index: Number(index), name: wname ?? '', active: isActive, command: command ?? '', path: cwd ?? '' });
      // Exit status is not always reported (older tmux): -1 means "ended, status unknown".
      if (isActive && dead === '1') s.deadStatus = deadStatus ? Number(deadStatus) : -1;
    }
    return [...sessions.values()];
  }

  async hasSession(name: string): Promise<boolean> {
    try {
      await this.run(['has-session', '-t', `=${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  async capturePane(name: string, lines: number): Promise<string[]> {
    const out = await this.run(['capture-pane', '-p', '-J', '-t', `=${name}:`, '-S', `-${lines}`]);
    return out.split('\n');
  }

  async newSession(name: string, opts: NewSessionOptions): Promise<void> {
    // With keepOnFailure, the pane starts on a placeholder so remain-on-exit is set before the real
    // command runs (a command failing instantly would otherwise close the session first).
    const deferred = !!opts.keepOnFailure && opts.command.length > 0;
    const args = ['new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', opts.cwd];
    for (const [k, v] of Object.entries(opts.env ?? {})) args.push('-e', `${k}=${v}`);
    if (deferred) args.push('--', 'sleep', '60');
    else if (opts.command.length > 0) args.push('--', ...opts.command);
    await this.run(args);
    // A phone joining must not shrink the session on the desktop: size follows the latest active client.
    await this.run(['set-option', '-t', `=${name}:`, 'window-size', 'latest']);
    for (const [k, v] of Object.entries(opts.userOptions ?? {})) {
      if (!k.startsWith('@')) throw new TmuxError(`Invalid user option ${k}`);
      await this.run(['set-option', '-t', `=${name}:`, k, v]);
    }
    if (deferred) {
      await this.run(['set-option', '-t', `=${name}:`, 'remain-on-exit', 'failed']);
      await this.run(['respawn-pane', '-k', '-t', `=${name}:`, '-c', opts.cwd, '--', ...opts.command]);
    }
  }

  async killSession(name: string): Promise<void> {
    await this.run(['kill-session', '-t', `=${name}`]);
  }

  attachCommand(name: string): AttachCommand {
    return { file: this.bin, args: [...this.baseArgs(), 'attach-session', '-t', `=${name}`] };
  }
}

/** Environment for tmux children: never inherit $TMUX (would refuse to nest). */
export function tmuxEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.TMUX;
  delete env.TMUX_PANE;
  return env;
}
