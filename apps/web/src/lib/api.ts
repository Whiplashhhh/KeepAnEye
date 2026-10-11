import type { ApiError } from '@kae/shared';

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Called whenever the server says the session is gone, so the app can go back to the login screen. */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: init.body !== undefined ? JSON.stringify(init.body) : null,
    });
  } catch {
    throw new RequestError(0, 'network', 'Serveur injoignable. Vérifie ta connexion Tailscale.');
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    if (res.status === 401 && data?.error === 'unauthenticated') unauthorizedListeners.forEach((f) => f());
    throw new RequestError(res.status, data?.error ?? 'http', data?.message ?? `Erreur ${res.status}`);
  }
  return data as T;
}

export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Sends a pasted / dropped image to the host; resolves to the file path the session can read. */
export async function uploadImage(session: string, image: Blob): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/sessions/${encodeURIComponent(session)}/upload`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': image.type },
      body: image,
    });
  } catch {
    throw new RequestError(0, 'network', 'Serveur injoignable. Vérifie ta connexion Tailscale.');
  }
  const data = (await res.json().catch(() => null)) as ({ path?: string } & Partial<ApiError>) | null;
  if (!res.ok || !data?.path) {
    if (res.status === 401 && data?.error === 'unauthenticated') unauthorizedListeners.forEach((f) => f());
    throw new RequestError(res.status, data?.error ?? 'http', data?.message ?? `Erreur ${res.status}`);
  }
  return data.path;
}
