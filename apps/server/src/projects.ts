import { readdir } from 'node:fs/promises';
import { PROJECT_NAME_RE } from '@kae/shared';

/** Project folders actually present in ~/claude-box/workspace (directories only, no hidden entries). */
export async function listProjects(workspaceDir: string): Promise<string[]> {
  try {
    const entries = await readdir(workspaceDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && PROJECT_NAME_RE.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** A project name is valid only if it matches the pattern AND exists in the workspace right now. */
export async function isValidProject(workspaceDir: string, name: unknown): Promise<boolean> {
  if (typeof name !== 'string' || !PROJECT_NAME_RE.test(name) || name === '.' || name === '..') return false;
  return (await listProjects(workspaceDir)).includes(name);
}
