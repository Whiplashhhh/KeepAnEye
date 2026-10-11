import { DEFAULT_NOTIFICATION_SETTINGS } from '@kae/shared';
import { describe, expect, it } from 'vitest';
import type { ClaudeEvent } from '../src/claude/events.js';
import type { StatusChange } from '../src/claude/tracker.js';
import { handleStatusChange } from '../src/push/notifier.js';
import { inDoNotDisturb, PushService } from '../src/push/service.js';
import { memDb } from './helpers.js';

const at = (h: number, m: number) => new Date(2026, 9, 11, h, m);

describe('do not disturb', () => {
  const s = { ...DEFAULT_NOTIFICATION_SETTINGS, dnd: { enabled: true, start: '22:30', end: '07:30' } };
  it('handles ranges that wrap past midnight', () => {
    expect(inDoNotDisturb(s, at(23, 0))).toBe(true);
    expect(inDoNotDisturb(s, at(3, 0))).toBe(true);
    expect(inDoNotDisturb(s, at(7, 30))).toBe(false);
    expect(inDoNotDisturb(s, at(12, 0))).toBe(false);
    expect(inDoNotDisturb(s, at(22, 29))).toBe(false);
  });
  it('handles same-day ranges and disabled mode', () => {
    const day = { ...s, dnd: { enabled: true, start: '12:00', end: '14:00' } };
    expect(inDoNotDisturb(day, at(13, 0))).toBe(true);
    expect(inDoNotDisturb(day, at(14, 0))).toBe(false);
    expect(inDoNotDisturb({ ...day, dnd: { ...day.dnd, enabled: false } }, at(13, 0))).toBe(false);
  });
});

function setup(now = at(12, 0)) {
  const sent: { endpoint: string; payload: string }[] = [];
  let fail: number | null = null;
  const db = memDb();
  const push = new PushService(
    db,
    'mailto:x@y.z',
    {
      async send(sub, payload) {
        if (fail) throw Object.assign(new Error('gone'), { statusCode: fail });
        sent.push({ endpoint: sub.endpoint, payload });
      },
    },
    () => now,
  );
  push.subscribe({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }, null);
  return { push, sent, setFail: (c: number | null) => (fail = c), db };
}

function change(to: StatusChange['to'], from: StatusChange['from'] = 'working', ts = Date.now()): StatusChange {
  return {
    session: 'web',
    from,
    to,
    activity: null,
    event: { ts } as ClaudeEvent,
    state: {
      session: 'web',
      status: to,
      claudeSessionId: null,
      cwd: null,
      transcriptPath: null,
      lastEvent: null,
      lastMessage: 'Claude needs your permission',
      updatedAt: ts,
    },
  };
}

describe('PushService', () => {
  it('generates and keeps VAPID keys', () => {
    const { push, db } = setup();
    const again = new PushService(db, 'mailto:x@y.z');
    expect(push.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(again.publicKey).toBe(push.publicKey);
  });

  it('notifies on waiting/done/error with a deep link', async () => {
    const { push, sent } = setup();
    await handleStatusChange(push, change('waiting'));
    const payload = JSON.parse(sent[0]!.payload);
    expect(payload).toMatchObject({ title: "web t'attend", url: '/s/web', tag: 'kae-web' });
    await handleStatusChange(push, change('done'));
    await handleStatusChange(push, change('error'));
    expect(sent).toHaveLength(3);
  });

  it('ignores non-transitions, idle/working, and stale backlog events', async () => {
    const { push, sent } = setup();
    expect(handleStatusChange(push, change('waiting', 'waiting'))).toBeNull();
    expect(handleStatusChange(push, change('working', 'idle'))).toBeNull();
    expect(handleStatusChange(push, change('done', 'working', Date.now() - 10 * 60_000))).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('respects per-type settings and DND', async () => {
    const { push, sent } = setup(at(23, 0));
    push.setSettings({ types: { waiting: true, done: false, error: true }, dnd: { enabled: false, start: '22:00', end: '07:00' } });
    await handleStatusChange(push, change('done'));
    expect(sent).toHaveLength(0);
    await handleStatusChange(push, change('waiting'));
    expect(sent).toHaveLength(1);
    push.setSettings({ types: { waiting: true, done: true, error: true }, dnd: { enabled: true, start: '22:00', end: '07:00' } });
    await handleStatusChange(push, change('waiting'));
    expect(sent).toHaveLength(1);
  });

  it('drops expired subscriptions', async () => {
    const { push, setFail } = setup();
    setFail(410);
    await push.notify('test', { title: 't', body: 'b', url: '/', tag: 't' });
    expect(push.count()).toBe(0);
  });
});
