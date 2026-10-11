import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ClaudeInfo, CreateSessionInput, SessionInfo, SessionKind } from '@kae/shared';
import { SESSION_NAME_RE, sortSessions } from '@kae/shared';
import type { ClaudeTracker } from './claude/tracker.js';
import { resolveTranscriptPath } from './claude/transcript.js';
import { HttpError } from './http/errors.js';
import { isValidProject } from './projects.js';
import type { Template } from './templates.js';
import { expandTemplate } from './templates.js';
import type { TmuxClient, TmuxSession } from './tmux/client.js';

export const PREVIEW_LINES = 6;
const MAX_PREVIEW_LINE = 240;

export interface SessionServiceOptions {
  templates: () => Template[];
  workspaceDir: string;
  claudeBoxDir: string;
  claudeHomeDir: string;
}

export class SessionService {
  constructor(
    private readonly tmux: TmuxClient,
    private readonly tracker: ClaudeTracker,
    private readonly opts: SessionServiceOptions,
  ) {}

  async list(): Promise<SessionInfo[]> {
    const raw = await this.tmux.listSessions();
    const states = this.tracker.all();
    const infos = await Promise.all(raw.map((s) => this.toInfo(s, states)));
    return sortSessions(infos);
  }

  private async toInfo(s: TmuxSession, states: ReturnType<ClaudeTracker['all']>): Promise<SessionInfo> {
    const state = states.get(s.name) ?? null;
    const isClaudeCommand = s.windows.some((w) => w.command === 'claude');
    const kind: SessionKind =
      s.kind === 'claude' || s.kind === 'terminal' ? s.kind : state || isClaudeCommand ? 'claude' : 'terminal';
    let project = s.project;
    if (!project && state?.cwd) {
      const m = /^\/workspace\/([^/]+)/.exec(state.cwd);
      if (m) project = m[1] ?? null;
    }

    let claude: ClaudeInfo | null = null;
    if (kind === 'claude') {
      const crashed = s.deadStatus !== null && s.deadStatus !== 0;
      claude = {
        status: crashed ? 'error' : (state?.status ?? 'idle'),
        lastEvent: state?.lastEvent ?? null,
        lastMessage: crashed
          ? `Le processus s'est arrêté${s.deadStatus! > 0 ? ` (code ${s.deadStatus})` : ''}. Ouvre le terminal pour voir pourquoi.`
          : (state?.lastMessage ?? null),
        updatedAt: state?.updatedAt ?? null,
        hasTranscript: !!resolveTranscriptPath(state?.transcriptPath ?? null, this.opts.claudeHomeDir),
      };
    }

    return {
      name: s.name,
      kind,
      project,
      template: s.template,
      createdAt: s.createdAt,
      // For Claude sessions the last hook event is the meaningful activity (the TUI redraws constantly).
      activityAt: kind === 'claude' && state ? state.updatedAt : s.activityAt,
      attached: s.attached,
      windows: s.windows,
      preview: await this.preview(s.name),
      manageable: SESSION_NAME_RE.test(s.name),
      claude,
    };
  }

  private async preview(name: string): Promise<string[]> {
    try {
      return cleanPreview(await this.tmux.capturePane(name, 80));
    } catch {
      return [];
    }
  }

  async create(input: CreateSessionInput): Promise<{ name: string }> {
    const template = this.opts.templates().find((t) => t.id === input.template);
    if (!template) throw new HttpError(400, 'unknown_template', 'Ce modèle de session n’existe pas.');
    if (await this.tmux.hasSession(input.name)) {
      throw new HttpError(409, 'session_exists', `Une session « ${input.name} » existe déjà. Choisis un autre nom.`);
    }
    let project: string | null = null;
    if (template.requiresProject) {
      if (!(await isValidProject(this.opts.workspaceDir, input.project))) {
        throw new HttpError(400, 'invalid_project', 'Ce projet n’existe pas dans ~/claude-box/workspace.');
      }
      project = input.project!;
    }
    let expanded;
    try {
      expanded = expandTemplate(
        template,
        { session: input.name, project, claudeBoxDir: this.opts.claudeBoxDir, workspaceDir: this.opts.workspaceDir },
        input.flags,
      );
    } catch (e) {
      throw new HttpError(400, 'invalid_flags', (e as Error).message);
    }
    const cwd = existsSync(expanded.cwd) ? expanded.cwd : homedir();
    this.tracker.reset(input.name);
    const userOptions: Record<string, string> = { '@kae_kind': template.kind, '@kae_template': template.id };
    if (project) userOptions['@kae_project'] = project;
    await this.tmux.newSession(input.name, {
      cwd,
      command: expanded.command,
      env: { KEEP_AN_EYE_SESSION: input.name },
      userOptions,
      keepOnFailure: template.keepOnFailure,
    });
    return { name: input.name };
  }

  async close(name: string): Promise<void> {
    if (!SESSION_NAME_RE.test(name)) throw new HttpError(400, 'invalid_name', 'Nom de session invalide.');
    if (!(await this.tmux.hasSession(name))) throw new HttpError(404, 'not_found', 'Cette session n’existe plus.');
    await this.tmux.killSession(name);
  }

  async exists(name: string): Promise<boolean> {
    return SESSION_NAME_RE.test(name) && this.tmux.hasSession(name);
  }
}

// Box-drawing and TUI chrome characters (Claude Code draws its prompt inside a box).
const FRAME = /^[\s│┃║╭╮╰╯┌┐└┘├┤─━═┏┓┗┛╔╗╚╝>❯]+|[\s│┃║╭╮╰╯┌┐└┘├┤─━═┏┓┗┛╔╗╚╝]+$/g;
const CHROME = /^(\? for shortcuts|esc to interrupt)$/i;

/** Last meaningful lines of a pane: frames, empty prompts and UI hints are dropped. */
export function cleanPreview(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(FRAME, '').trimEnd();
    const letters = line.replace(/[^\p{L}\p{N}]/gu, '');
    if (letters.length < 2 || CHROME.test(line.trim())) continue;
    out.push(line.length > MAX_PREVIEW_LINE ? line.slice(0, MAX_PREVIEW_LINE) : line);
  }
  return out.slice(-PREVIEW_LINES);
}
