import type { NotificationSettings, NotifyType } from '@kae/shared';
import { DEFAULT_NOTIFICATION_SETTINGS, notificationSettingsSchema } from '@kae/shared';
import webpush from 'web-push';
import type { DB } from '../db.js';
import { kvGet, kvSet } from '../db.js';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushSender {
  send(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string): Promise<void>;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Minutes since midnight for "HH:MM". */
function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True if `date` (local time) falls in the do-not-disturb range; ranges may wrap past midnight. */
export function inDoNotDisturb(settings: NotificationSettings, date: Date): boolean {
  if (!settings.dnd.enabled) return false;
  const start = minutes(settings.dnd.start);
  const end = minutes(settings.dnd.end);
  const now = date.getHours() * 60 + date.getMinutes();
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export class PushService {
  private readonly vapid: VapidKeys;
  private readonly sender: PushSender;

  constructor(
    private readonly db: DB,
    subject: string,
    sender?: PushSender,
    private readonly now: () => Date = () => new Date(),
  ) {
    let keys = kvGet<VapidKeys>(db, 'vapid');
    if (!keys) {
      keys = webpush.generateVAPIDKeys();
      kvSet(db, 'vapid', keys);
    }
    this.vapid = keys;
    const vapid = this.vapid;
    this.sender = sender ?? {
      async send(sub, payload) {
        await webpush.sendNotification(sub, payload, {
          TTL: 3600,
          urgency: 'high',
          vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        });
      },
    };
  }

  get publicKey(): string {
    return this.vapid.publicKey;
  }

  getSettings(): NotificationSettings {
    const parsed = notificationSettingsSchema.safeParse(kvGet(this.db, 'notifications'));
    return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_SETTINGS;
  }

  setSettings(s: NotificationSettings): void {
    kvSet(this.db, 'notifications', s);
  }

  subscribe(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | null): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 300) ?? null, Date.now());
  }

  unsubscribe(endpoint: string): void {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n;
  }

  /** Sends to every subscription unless the type is disabled or DND is on. Returns the number delivered. */
  async notify(type: NotifyType | 'test', payload: PushPayload): Promise<number> {
    if (type !== 'test') {
      const s = this.getSettings();
      if (!s.types[type] || inDoNotDisturb(s, this.now())) return 0;
    }
    const subs = this.db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as {
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];
    const body = JSON.stringify(payload);
    let delivered = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await this.sender.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
          delivered++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) this.unsubscribe(s.endpoint); // subscription gone
        }
      }),
    );
    return delivered;
  }
}
