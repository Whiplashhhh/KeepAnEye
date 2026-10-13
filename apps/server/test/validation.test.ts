import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSessionSchema, parseRepoRef, SESSION_NAME_RE } from '@kae/shared';
import { describe, expect, it } from 'vitest';
import { isValidProject, listProjects } from '../src/projects.js';
import { expandTemplate, loadTemplates } from '../src/templates.js';
import { tempDir, testConfig } from './helpers.js';

describe('repo references', () => {
  it('accepts owner/repo, GitHub URLs and SSH remotes', () => {
    const want = { repo: 'Whiplashhhh/EDT', project: 'EDT' };
    for (const r of ['Whiplashhhh/EDT', ' Whiplashhhh/EDT ', 'https://github.com/Whiplashhhh/EDT', 'github.com/Whiplashhhh/EDT/', 'https://github.com/Whiplashhhh/EDT.git', 'git@github.com:Whiplashhhh/EDT.git']) {
      expect(parseRepoRef(r), r).toEqual(want);
    }
    expect(parseRepoRef('me/my.repo_2')).toEqual({ repo: 'me/my.repo_2', project: 'my.repo_2' });
  });

  it('rejects anything that could escape the workspace or reach a shell', () => {
    for (const r of ['', 'EDT', 'a/b/c', '../etc', 'owner/..', 'owner/.hidden', 'a/b c', 'x/y;reboot', '-x/y', 'https://evil.com/a/b', '$(id)/x']) {
      expect(parseRepoRef(r), r).toBeNull();
    }
  });
});

describe('session names', () => {
  it('accepts the documented pattern', () => {
    for (const n of ['a', 'web-app', 'claude_1', 'A'.repeat(40), '0']) expect(SESSION_NAME_RE.test(n)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const n of ['', 'A'.repeat(41), 'a b', 'a;rm -rf', '$(id)', 'a.b', 'a:b', '../x', 'é', 'a\nb', '`x`']) {
      expect(SESSION_NAME_RE.test(n), n).toBe(false);
    }
    expect(createSessionSchema.safeParse({ name: 'bad name', template: 'terminal' }).success).toBe(false);
  });
});

describe('projects', () => {
  it('lists only real, visible directories', async () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'webapp'));
    mkdirSync(path.join(dir, 'api.v2'));
    mkdirSync(path.join(dir, '.hidden'));
    mkdirSync(path.join(dir, 'with space'));
    writeFileSync(path.join(dir, 'file.txt'), '');
    symlinkSync('/etc', path.join(dir, 'link'));
    expect(await listProjects(dir)).toEqual(['api.v2', 'webapp']);
  });

  it('validates against the actual workspace content', async () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'webapp'));
    expect(await isValidProject(dir, 'webapp')).toBe(true);
    for (const bad of ['missing', '..', '.', '../webapp', 'webapp/', '/etc', '', undefined, 42, '.hidden']) {
      expect(await isValidProject(dir, bad)).toBe(false);
    }
  });

  it('returns nothing when the workspace does not exist', async () => {
    expect(await listProjects('/nonexistent/path')).toEqual([]);
  });
});

describe('templates', () => {
  const cfg = testConfig();
  const templates = loadTemplates(cfg.templatesFile);
  const claude = templates.find((t) => t.id === 'claude')!;
  const ctx = { session: 'web', project: 'webapp', claudeBoxDir: '/home/me/claude-box', workspaceDir: '/home/me/claude-box/workspace' };

  it('expands the Claude command exactly as specified', () => {
    expect(expandTemplate(claude, ctx, []).command).toEqual([
      'docker', 'compose', '-f', '/home/me/claude-box/compose.yml', 'exec', '-u', 'claude', '-w', '/workspace/webapp',
      '-e', 'KEEP_AN_EYE_SESSION=web', 'claude', 'claude',
    ]);
  });

  it('autonomous flag adds --dangerously-skip-permissions', () => {
    const cmd = expandTemplate(claude, ctx, ['autonomous']).command;
    expect(cmd.slice(-2)).toEqual(['claude', '--dangerously-skip-permissions']);
  });

  it('model and effort add their args before the checked flags', () => {
    const cmd = expandTemplate(claude, ctx, ['autonomous'], { model: 'opus', effort: 'high' }).command;
    expect(cmd.slice(cmd.indexOf('--model'))).toEqual(['--model', 'opus', '--effort', 'high', '--dangerously-skip-permissions']);
  });

  it('rejects unknown models and efforts', () => {
    expect(() => expandTemplate(claude, ctx, [], { model: 'gpt' })).toThrow(/Modèle/);
    expect(() => expandTemplate(claude, ctx, [], { effort: '--rm' })).toThrow(/réflexion/);
  });

  it('rejects unknown flags', () => {
    expect(() => expandTemplate(claude, ctx, ['rm'])).toThrow();
  });

  it('terminal template runs the default shell', () => {
    const t = templates.find((x) => x.id === 'terminal')!;
    expect(expandTemplate(t, { ...ctx, project: null, home: '/home/me' }, [])).toEqual({ command: [], cwd: '/home/me' });
  });

  it('rejects invalid template files', () => {
    const dir = tempDir();
    const f = path.join(dir, 't.json');
    writeFileSync(f, JSON.stringify({ templates: [{ id: 'bad id', label: 'x', kind: 'terminal' }] }));
    expect(() => loadTemplates(f)).toThrow(/invalide/);
  });
});
