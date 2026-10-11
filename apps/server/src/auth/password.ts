import { hash, verify } from '@node-rs/argon2';

// argon2id (algorithm 2) with OWASP-recommended parameters: 19 MiB, 2 iterations.
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** A valid hash to verify against when no admin exists, so timing does not reveal it. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('keep-an-eye-dummy-password');
  return dummyHash;
}
