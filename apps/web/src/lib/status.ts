import type { ClaudeStatus, SessionInfo } from '@kae/shared';
import type { LucideIcon } from 'lucide-react';
import { CircleAlert, CircleCheck, CircleDashed, Hand, LoaderCircle } from 'lucide-react';

export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  /** Tailwind classes using the semantic status tokens. */
  text: string;
  soft: string;
  dot: string;
  ring: string;
}

export const STATUS: Record<ClaudeStatus, StatusMeta> = {
  waiting: { label: "T'attend", icon: Hand, text: 'text-waiting', soft: 'bg-waiting-soft', dot: 'bg-waiting', ring: 'ring-waiting/40' },
  working: { label: 'Travaille', icon: LoaderCircle, text: 'text-working', soft: 'bg-working-soft', dot: 'bg-working', ring: 'ring-working/30' },
  done: { label: 'Terminé', icon: CircleCheck, text: 'text-done', soft: 'bg-done-soft', dot: 'bg-done', ring: 'ring-done/30' },
  error: { label: 'Erreur', icon: CircleAlert, text: 'text-error', soft: 'bg-error-soft', dot: 'bg-error', ring: 'ring-error/40' },
  idle: { label: 'Inactif', icon: CircleDashed, text: 'text-idle', soft: 'bg-idle-soft', dot: 'bg-idle', ring: 'ring-idle/30' },
};

export function waitingCount(sessions: SessionInfo[]): number {
  return sessions.filter((s) => s.claude?.status === 'waiting').length;
}
