import { randomBytes } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const UPLOAD_DIR_NAME = '.kae-uploads';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** Image types accepted from the clipboard / drag and drop, with the magic bytes that prove them. */
const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { ext: 'gif', magic: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

export const UPLOAD_CONTENT_TYPES = Object.keys(IMAGE_TYPES);

export class UploadError extends Error {}

/**
 * Stores a pasted image where both the host's tmux sessions and the claude-box container can read it:
 * `<workspace>/.kae-uploads` (= /workspace/.kae-uploads inside claude-box). Returns the file name.
 */
export async function saveUpload(workspaceDir: string, contentType: string, data: Buffer): Promise<string> {
  const type = IMAGE_TYPES[contentType];
  if (!type) throw new UploadError('Seules les images PNG, JPEG, GIF et WebP sont acceptées.');
  if (data.length === 0 || data.length > MAX_UPLOAD_BYTES) throw new UploadError('Image vide ou trop lourde (10 Mo maximum).');
  if (!type.magic(data)) throw new UploadError('Le contenu ne correspond pas au type d’image annoncé.');

  const dir = path.join(workspaceDir, UPLOAD_DIR_NAME);
  // 0755 / 0644: the claude user inside the container is not necessarily the same uid as the host user.
  await mkdir(dir, { recursive: true, mode: 0o755 });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const file = `paste-${stamp}-${randomBytes(3).toString('hex')}.${type.ext}`;
  await writeFile(path.join(dir, file), data, { mode: 0o644, flag: 'wx' });
  void pruneUploads(dir);
  return file;
}

/** Old pastes are of no use after a few days: drop them (best effort). */
async function pruneUploads(dir: string): Promise<void> {
  try {
    const now = Date.now();
    for (const f of await readdir(dir)) {
      if (!f.startsWith('paste-')) continue;
      const p = path.join(dir, f);
      if (now - (await stat(p)).mtimeMs > MAX_AGE_MS) await unlink(p);
    }
  } catch {
    // not worth failing an upload over
  }
}
