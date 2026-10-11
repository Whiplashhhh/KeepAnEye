import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEventLine } from '../src/claude/events.js';
import { REPO_ROOT } from '../src/config.js';
import { tempDir } from './helpers.js';

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'install-claude-hooks.sh');

function hasJq(): boolean {
  try {
    execFileSync('jq', ['--version']);
    return true;
  } catch {
    return false;
  }
}

function setup() {
  const home = tempDir();
  const events = path.join(tempDir(), 'claude.jsonl');
  mkdirSync(path.join(home, '.claude'));
  const settings = path.join(home, '.claude', 'settings.json');
  const original = {
    model: 'opus',
    permissions: { allow: ['Bash(npm test)'] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }] },
  };
  writeFileSync(settings, JSON.stringify(original, null, 2));
  const run = (...args: string[]) =>
    execFileSync('bash', [SCRIPT, '--events', events, ...args], { env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '' } }).toString();
  return { home, events, settings, original, run };
}

describe.skipIf(!hasJq())('install-claude-hooks.sh', () => {
  it('adds the six hooks without touching other settings, idempotently', () => {
    const { settings, original, run } = setup();
    run();
    run(); // twice: no duplicates
    const s = JSON.parse(readFileSync(settings, 'utf8'));
    expect(s.model).toBe('opus');
    expect(s.permissions).toEqual(original.permissions);
    for (const e of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'Notification', 'SessionEnd']) {
      const cmds = s.hooks[e].flatMap((h: { hooks: { command: string }[] }) => h.hooks.map((x) => x.command));
      expect(cmds.filter((c: string) => c.endsWith('keep-an-eye-hook.sh')), e).toHaveLength(1);
    }
    expect(s.hooks.Stop[0].hooks[0].command).toBe('notify-send done');
    expect(s.hooks.PreToolUse[0].matcher).toBe('*');
  });

  it('the hook appends compact, parseable, size-limited events', () => {
    const { home, events, run } = setup();
    run();
    const hook = path.join(home, '.claude', 'keep-an-eye-hook.sh');
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 'abc',
      cwd: '/workspace/web',
      transcript_path: '/home/claude/.claude/projects/-workspace-web/abc.jsonl',
      tool_name: 'Write',
      tool_input: { file_path: '/workspace/web/a.ts', content: 'x'.repeat(200_000) },
    };
    const out = execFileSync(hook, { input: JSON.stringify(payload), env: { ...process.env, KEEP_AN_EYE_SESSION: 'web' } }).toString();
    expect(out).toBe(''); // nothing on stdout: it would be injected into Claude's context
    // Without a session name (Claude started outside the app), nothing is written.
    execFileSync(hook, { input: JSON.stringify(payload), env: { ...process.env, KEEP_AN_EYE_SESSION: '' } });
    const lines = readFileSync(events, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBeLessThan(1000); // file content was dropped
    const ev = parseEventLine(lines[0]!, Date.now());
    expect(ev).toMatchObject({ session: 'web', hook: 'PreToolUse', toolName: 'Write', toolSummary: '/workspace/web/a.ts' });
  });

  it('never fails Claude, even if the events directory is missing', () => {
    const { home, run } = setup();
    run();
    const hook = path.join(home, '.claude', 'keep-an-eye-hook.sh');
    expect(() =>
      execFileSync(hook, { input: '{}', env: { ...process.env, KEEP_AN_EYE_SESSION: 'web', KEEP_AN_EYE_EVENTS: '/nonexistent/dir/x.jsonl' } }),
    ).not.toThrow();
    expect(() => execFileSync(hook, { input: 'not json', env: { ...process.env, KEEP_AN_EYE_SESSION: 'web' } })).not.toThrow();
  });

  it('uninstall removes only our hooks', () => {
    const { settings, original, run } = setup();
    run();
    run('--uninstall');
    expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual(original);
  });

  it('refuses to touch an invalid settings file', () => {
    const { settings, run } = setup();
    writeFileSync(settings, '{ broken');
    expect(() => run()).toThrow();
    expect(readFileSync(settings, 'utf8')).toBe('{ broken');
  });
});
