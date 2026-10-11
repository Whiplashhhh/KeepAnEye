import type { ClaudeStatus } from '@kae/shared';
import type { ClaudeEvent } from './events.js';

export interface ClaudeState {
  session: string;
  status: ClaudeStatus;
  claudeSessionId: string | null;
  cwd: string | null;
  transcriptPath: string | null;
  lastEvent: string | null;
  lastMessage: string | null;
  updatedAt: number;
}

export interface Transition {
  state: ClaudeState;
  /** Set when the status changed (or a notable event happened): text for the activity feed. */
  activity: string | null;
  statusChanged: boolean;
}

function oneLine(s: string, max = 140): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Pure reducer: previous state + hook event → next state. */
export function applyEvent(prev: ClaudeState | null, ev: ClaudeEvent): Transition {
  const base: ClaudeState = prev ?? {
    session: ev.session,
    status: 'idle',
    claudeSessionId: null,
    cwd: null,
    transcriptPath: null,
    lastEvent: null,
    lastMessage: null,
    updatedAt: 0,
  };
  let status = base.status;
  let lastMessage = base.lastMessage;
  let activity: string | null = null;

  switch (ev.hook) {
    case 'SessionStart':
      status = 'idle';
      lastMessage = 'Session démarrée';
      activity = 'Session Claude démarrée';
      break;
    case 'UserPromptSubmit':
      status = 'working';
      lastMessage = ev.prompt ? `Demande : ${oneLine(ev.prompt)}` : 'Nouvelle demande';
      activity = ev.prompt ? `Nouvelle demande : ${oneLine(ev.prompt)}` : 'Nouvelle demande';
      break;
    case 'PreToolUse':
    case 'PostToolUse':
      status = 'working';
      if (ev.toolName) lastMessage = ev.toolSummary ? `${ev.toolName} · ${oneLine(ev.toolSummary, 100)}` : ev.toolName;
      break;
    case 'SubagentStop':
      break;
    case 'Notification':
      // idle_prompt fires ~60 s after Stop: the task is still "done", not a new request for attention.
      if (ev.notificationType === 'idle_prompt' && base.status === 'done') break;
      status = 'waiting';
      lastMessage = ev.message ? oneLine(ev.message) : 'Claude attend ta réponse';
      activity = lastMessage;
      break;
    case 'Stop':
      status = 'done';
      lastMessage = 'Tâche terminée';
      activity = 'A terminé sa tâche';
      break;
    case 'StopFailure':
      status = 'error';
      lastMessage = ev.message ? `Erreur : ${oneLine(ev.message)}` : 'Erreur';
      activity = lastMessage;
      break;
    case 'SessionEnd':
      status = 'idle';
      lastMessage = 'Session Claude fermée';
      activity = 'Session Claude fermée';
      break;
  }

  const state: ClaudeState = {
    session: ev.session,
    status,
    claudeSessionId: ev.claudeSessionId ?? base.claudeSessionId,
    cwd: ev.cwd ?? base.cwd,
    transcriptPath: ev.transcriptPath ?? base.transcriptPath,
    lastEvent: ev.hook,
    lastMessage,
    updatedAt: Math.max(ev.ts, base.updatedAt),
  };
  const statusChanged = status !== base.status;
  return { state, activity: statusChanged || ev.hook === 'UserPromptSubmit' ? activity : null, statusChanged };
}
