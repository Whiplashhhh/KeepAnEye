const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Allowed origins are exact `scheme://host[:port]` strings, compared verbatim (no wildcard). */
export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin || origin === 'null') return false;
  return allowed.includes(origin.replace(/\/+$/, ''));
}

/** Requests that change state must carry an allowed Origin header. */
export function requiresOriginCheck(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}
