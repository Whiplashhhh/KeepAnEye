import type { IncomingMessage } from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Client IP for raw Node requests (WebSocket upgrades): X-Forwarded-For is trusted only from loopback. */
export function clientIp(req: IncomingMessage): string | null {
  const remote = req.socket.remoteAddress ?? null;
  const xff = req.headers['x-forwarded-for'];
  if (remote && LOOPBACK.has(remote) && typeof xff === 'string' && xff) {
    const last = xff.split(',').pop()?.trim();
    if (last) return last;
  }
  return remote;
}
