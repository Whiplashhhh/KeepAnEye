import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTranscript, readTimeline, resolveTranscriptPath } from '../src/claude/transcript.js';
import { tempDir } from './helpers.js';

function claudeHome() {
  const home = tempDir();
  const proj = path.join(home, '.claude', 'projects', '-workspace-web');
  mkdirSync(proj, { recursive: true });
  return { home, proj };
}

const entry = (type: string, content: unknown, ts = '2026-10-11T10:00:00.000Z') =>
  JSON.stringify({ type, timestamp: ts, message: { role: type, content } });

describe('transcript path resolution', () => {
  it('maps the container path to the host', () => {
    const { home, proj } = claudeHome();
    writeFileSync(path.join(proj, 's1.jsonl'), '');
    expect(resolveTranscriptPath('/home/claude/.claude/projects/-workspace-web/s1.jsonl', home)).toBe(
      path.join(proj, 's1.jsonl'),
    );
  });

  it('refuses traversal, other roots and symlink escapes', () => {
    const { home, proj } = claudeHome();
    writeFileSync(path.join(home, 'secret.jsonl'), '');
    symlinkSync(path.join(home, 'secret.jsonl'), path.join(proj, 'evil.jsonl'));
    for (const bad of [
      null,
      '',
      '/etc/passwd',
      '/home/claude/.claude/projects/../../secret.jsonl',
      '/home/claude/secret.jsonl',
      '/home/claude/.claude/projects/-workspace-web/evil.jsonl',
      '/home/claude/.claude/projects/-workspace-web/missing.jsonl',
      '/home/claude/.claude/projects/-workspace-web/s1.txt',
      '/home/claude//.claude/projects/x.jsonl',
    ]) {
      expect(resolveTranscriptPath(bad, home), String(bad)).toBeNull();
    }
  });
});

describe('transcript parsing', () => {
  it('builds a readable timeline', () => {
    const text = [
      entry('user', 'Ajoute un bouton de déconnexion'),
      entry('assistant', [
        { type: 'text', text: 'Je regarde le composant.' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/workspace/web/src/App.tsx' } },
      ]),
      entry('user', [{ type: 'tool_result', content: 'ok' }]),
      entry('assistant', [{ type: 'tool_use', name: 'Edit', input: { file_path: '/workspace/web/src/App.tsx' } }]),
      entry('user', [{ type: 'tool_result', content: [{ type: 'text', text: 'boom' }], is_error: true }]),
      entry('assistant', [{ type: 'text', text: 'C’est fait.' }]),
    ].join('\n');
    const t = parseTranscript(text);
    expect(t.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'tool', 'result', 'assistant']);
    expect(t.filesTouched).toEqual(['/workspace/web/src/App.tsx']);
    expect(t.lastAssistant).toBe('C’est fait.');
    expect(t.items[0]!.ts).toBe(Date.parse('2026-10-11T10:00:00.000Z'));
  });

  it('survives garbage and hostile content', () => {
    const text = [
      'not json',
      '{"type":"assistant","message":{"content":"not an array"}}',
      '{"type":"assistant","message":{"content":[null, 5, {"type":"tool_use","name":{"x":1}}]}}',
      entry('user', '<command-name>/clear</command-name>'),
      entry('assistant', [{ type: 'text', text: '<script>alert(1)</script>' }]),
      JSON.stringify({ type: 'user', isMeta: true, message: { content: 'meta' } }),
    ].join('\n');
    const t = parseTranscript(text);
    // Text is returned as data; the UI renders it escaped.
    expect(t.items).toEqual([{ kind: 'assistant', ts: expect.any(Number), text: '<script>alert(1)</script>' }]);
  });

  it('reads only the tail of large files', () => {
    const { home, proj } = claudeHome();
    const lines: string[] = [];
    for (let i = 0; i < 4000; i++) lines.push(entry('assistant', [{ type: 'text', text: `message ${i} ${'x'.repeat(200)}` }]));
    writeFileSync(path.join(proj, 'big.jsonl'), lines.join('\n'));
    const t = readTimeline('/home/claude/.claude/projects/-workspace-web/big.jsonl', home);
    expect(t.available).toBe(true);
    expect(t.items.length).toBeLessThanOrEqual(200);
    expect(t.lastAssistant).toContain('message 3999');
  });

  it('reports unavailability clearly', () => {
    expect(readTimeline(null, '/nope').available).toBe(false);
  });
});
