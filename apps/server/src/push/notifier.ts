import type { NotifyType } from '@kae/shared';
import type { StatusChange } from '../claude/tracker.js';
import type { PushService } from './service.js';

/** Events older than this (backlog replay after a restart) never trigger a notification. */
const MAX_EVENT_AGE_MS = 2 * 60_000;

export function notificationFor(change: StatusChange): { type: NotifyType; title: string; body: string } | null {
  const name = change.session;
  const msg = change.state.lastMessage ?? '';
  switch (change.to) {
    case 'waiting':
      return { type: 'waiting', title: `${name} t'attend`, body: msg || 'Claude attend ta réponse.' };
    case 'done':
      return { type: 'done', title: `${name} a terminé`, body: 'La tâche est terminée.' };
    case 'error':
      return { type: 'error', title: `${name} : erreur`, body: msg || 'La session a rencontré une erreur.' };
    default:
      return null;
  }
}

export function handleStatusChange(push: PushService, change: StatusChange, now = Date.now()): Promise<number> | null {
  if (change.from === change.to) return null;
  if (now - change.event.ts > MAX_EVENT_AGE_MS) return null;
  const n = notificationFor(change);
  if (!n) return null;
  return push.notify(n.type, {
    title: n.title,
    body: n.body,
    url: `/s/${encodeURIComponent(change.session)}`,
    tag: `kae-${change.session}`,
  });
}
