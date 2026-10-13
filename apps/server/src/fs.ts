import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DirListing } from '@kae/shared';
import { HttpError } from './http/errors.js';

const MAX_ENTRIES = 2000;

/** Absolute, normalized path; anything else is refused before touching the filesystem. */
export function absolutePath(p: string): string {
  if (!path.isAbsolute(p) || p.includes('\0')) throw new HttpError(400, 'invalid_path', 'Chemin invalide : il doit être absolu.');
  return path.resolve(p);
}

/** Throws a readable 400 unless `p` is an existing directory (symlinks followed). */
export async function assertDirectory(p: string): Promise<void> {
  const st = await stat(p).catch(() => null);
  if (!st) throw new HttpError(400, 'not_found', `Le dossier ${p} est introuvable.`);
  if (!st.isDirectory()) throw new HttpError(400, 'not_a_directory', `${p} n’est pas un dossier.`);
}

/** Sub-directories of `dir` (symlinks to directories included), sorted, hidden ones flagged. */
export async function listDirectory(dir: string): Promise<DirListing> {
  const abs = absolutePath(dir);
  await assertDirectory(abs);
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    throw new HttpError(403, 'forbidden', `Impossible de lire ${abs} (permissions).`);
  }
  const dirs: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) dirs.push(e.name);
    else if (e.isSymbolicLink() && (await stat(path.join(abs, e.name)).catch(() => null))?.isDirectory()) dirs.push(e.name);
  }
  dirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  return {
    path: abs,
    parent: abs === path.parse(abs).root ? null : path.dirname(abs),
    entries: dirs.slice(0, MAX_ENTRIES).map((name) => ({ name, hidden: name.startsWith('.') })),
    truncated: dirs.length > MAX_ENTRIES,
  };
}

/** Creates `name` inside `parent` (one level, no separators) and returns its absolute path. */
export async function makeDirectory(parent: string, name: string): Promise<string> {
  const abs = absolutePath(parent);
  const clean = name.trim();
  if (!clean || clean === '.' || clean === '..' || /[/\\\0]/.test(clean) || Buffer.byteLength(clean) > 255) {
    throw new HttpError(400, 'invalid_name', 'Nom de dossier invalide (pas de « / », 255 octets max).');
  }
  await assertDirectory(abs);
  const target = path.join(abs, clean);
  try {
    await mkdir(target);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new HttpError(409, 'exists', `« ${clean} » existe déjà ici.`);
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new HttpError(403, 'forbidden', `Pas le droit de créer un dossier dans ${abs}.`);
    }
    throw e;
  }
  return target;
}
