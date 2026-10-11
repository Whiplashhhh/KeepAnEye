import { SESSION_NAME_RE } from '@kae/shared';

/** Hook events written by claude-box. Untrusted: size-limited, every field checked and truncated. */
export const MAX_EVENT_LINE_BYTES = 64 * 1024;
const MAX_TEXT = 2000;
const MAX_PATH = 1024;

export const KNOWN_HOOKS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'StopFailure',
  'SubagentStop',
  'Notification',
  'SessionEnd',
] as const;
export type HookName = (typeof KNOWN_HOOKS)[number];

export interface ClaudeEvent {
  session: string;
  hook: HookName;
  ts: number;
  claudeSessionId: string | null;
  transcriptPath: string | null;
  cwd: string | null;
  prompt: string | null;
  toolName: string | null;
  toolSummary: string | null;
  message: string | null;
  notificationType: string | null;
  reason: string | null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  // Strip control characters (except tab/newline) so nothing odd ends up in logs or notifications.
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, '');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** One-line description of a tool call, from untrusted tool_input. */
export function summarizeToolInput(tool: string | null, input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const i = input as Record<string, unknown>;
  const pick = (k: string) => str(i[k], 300);
  switch (tool) {
    case 'Bash':
      return pick('command');
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return pick('file_path') ?? pick('notebook_path');
    case 'Grep':
    case 'Glob':
      return pick('pattern');
    case 'WebFetch':
      return pick('url');
    case 'WebSearch':
      return pick('query');
    case 'Task':
    case 'Agent':
      return pick('description');
    default:
      return pick('description') ?? pick('file_path') ?? pick('command') ?? null;
  }
}

/** Parses one JSONL line. Returns null for anything malformed, oversized or not attributable to a session. */
export function parseEventLine(line: string, nowMs: number = Date.now()): ClaudeEvent | null {
  if (!line || Buffer.byteLength(line, 'utf8') > MAX_EVENT_LINE_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const session = o.KEEP_AN_EYE_SESSION;
  if (typeof session !== 'string' || !SESSION_NAME_RE.test(session)) return null;
  const hook = o.hook_event_name;
  if (typeof hook !== 'string' || !(KNOWN_HOOKS as readonly string[]).includes(hook)) return null;

  let ts = nowMs;
  if (typeof o.ts === 'number' && Number.isFinite(o.ts)) {
    // jq `now` gives seconds (float); accept milliseconds too. Clamp to a sane range.
    const ms = o.ts > 1e12 ? o.ts : o.ts * 1000;
    if (ms > 946684800000 && ms < nowMs + 24 * 3600_000) ts = Math.round(ms);
  }
  const toolName = str(o.tool_name, 100);
  return {
    session,
    hook: hook as HookName,
    ts,
    claudeSessionId: str(o.session_id, 100),
    transcriptPath: str(o.transcript_path, MAX_PATH),
    cwd: str(o.cwd, MAX_PATH),
    prompt: str(o.prompt, MAX_TEXT),
    toolName,
    toolSummary: summarizeToolInput(toolName, o.tool_input),
    message: str(o.message, MAX_TEXT) ?? str(o.error, MAX_TEXT),
    notificationType: str(o.notification_type, 50),
    reason: str(o.reason, 200) ?? str(o.source, 200),
  };
}
