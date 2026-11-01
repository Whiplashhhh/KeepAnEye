import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_NAME_RE, type RepoRef } from '@kae/shared';

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

export interface RepoCloner {
  /** Clones the repo into `<workspace>/<ref.project>`. Rejects with a readable message. */
  clone(ref: RepoRef): Promise<void>;
}

/**
 * Clones inside the claude-box container, as the claude user: that is where gh and the entire CLI
 * are logged in, and the clone lands in /workspace (= ~/claude-box/workspace on the host) with the
 * right owner. execFile, never a shell; the ref is validated by parseRepoRef beforehand.
 *
 * GitHub: `gh repo clone`. Entire: `entire repo clone`, then `entire enable` so the session capture
 * (Claude Code hooks + git hooks, which a clone doesn't carry) is on before Claude starts.
 */
export class ClaudeBoxCloner implements RepoCloner {
  constructor(
    private readonly dockerBin: string,
    private readonly claudeBoxDir: string,
    private readonly service = 'claude',
    private readonly timeoutMs = 5 * 60_000,
  ) {}

  async clone(ref: RepoRef): Promise<void> {
    if (ref.forge === 'github') {
      await this.exec('/workspace', ['gh', 'repo', 'clone', ref.repo, ref.project]);
      return;
    }
    await this.exec('/workspace', ['entire', 'repo', 'clone', ref.repo, ref.project]);
    try {
      await this.exec(`/workspace/${ref.project}`, ['entire', 'enable', '--yes', '--agent', 'claude-code']);
    } catch (e) {
      throw new Error(`cloné, mais « entire enable » a échoué (lance-le dans le projet) : ${(e as Error).message}`);
    }
  }

  private exec(cwd: string, command: string[]): Promise<void> {
    const args = [
      'compose', '-f', path.join(this.claudeBoxDir, 'compose.yml'),
      'exec', '-T', '-u', 'claude', '-w', cwd, this.service,
      ...command,
    ];
    return new Promise((resolve, reject) => {
      execFile(this.dockerBin, args, { timeout: this.timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) => {
        if (!err) return resolve();
        const detail = (stderr || err.message).trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);
        reject(new Error(detail || `échec de ${command[0]}`));
      });
    });
  }
}
