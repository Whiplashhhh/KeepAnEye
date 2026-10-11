import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ClaudeEvent } from '../src/claude/events.js';
import { EventsWatcher } from '../src/claude/watcher.js';
import { memDb, tempDir } from './helpers.js';

const evLine = (hook: string, session = 'web', extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ KEEP_AN_EYE_SESSION: session, hook_event_name: hook, ...extra })}\n`;

function setup(opts: { rotateBytes?: number } = {}) {
  const dir = tempDir();
  const file = path.join(dir, 'claude.jsonl');
  const db = memDb();
  const seen: ClaudeEvent[] = [];
  const w = new EventsWatcher(db, { file, ...opts }, (e) => seen.push(e));
  return { dir, file, db, seen, w };
}

describe('EventsWatcher', () => {
  it('waits quietly for a missing file', () => {
    const { w, seen } = setup();
    w.poll();
    expect(seen).toHaveLength(0);
  });

  it('reads new lines incrementally', () => {
    const { file, w, seen } = setup();
    writeFileSync(file, evLine('SessionStart'));
    w.poll();
    expect(seen.map((e) => e.hook)).toEqual(['SessionStart']);
    appendFileSync(file, evLine('UserPromptSubmit') + evLine('Stop'));
    w.poll();
    expect(seen.map((e) => e.hook)).toEqual(['SessionStart', 'UserPromptSubmit', 'Stop']);
    w.poll();
    expect(seen).toHaveLength(3);
  });

  it('buffers partial lines until complete', () => {
    const { file, w, seen } = setup();
    const l = evLine('Stop');
    writeFileSync(file, l.slice(0, 20));
    w.poll();
    expect(seen).toHaveLength(0);
    appendFileSync(file, l.slice(20));
    w.poll();
    expect(seen).toHaveLength(1);
  });

  it('decodes multi-byte characters split across reads', () => {
    const dir = tempDir();
    const file = path.join(dir, 'claude.jsonl');
    const seen: ClaudeEvent[] = [];
    const w = new EventsWatcher(memDb(), { file, chunkBytes: 7 }, (e) => seen.push(e));
    writeFileSync(file, evLine('Notification', 'web', { message: 'Réponse attendue — émoji 🚀' }));
    for (let i = 0; i < 10; i++) w.poll(); // 28 bytes per tick with this chunk size
    expect(seen[0]?.message).toBe('Réponse attendue — émoji 🚀');
  });

  it('skips garbage lines without stopping', () => {
    const { file, w, seen } = setup();
    writeFileSync(file, `not json\n{"half":\n${'x'.repeat(100_000)}\n${evLine('Stop')}`);
    w.poll();
    expect(seen.map((e) => e.hook)).toEqual(['Stop']);
  });

  it('resumes from the stored position after a restart', () => {
    const { file, db, seen } = setup();
    writeFileSync(file, evLine('SessionStart'));
    new EventsWatcher(db, { file }, (e) => seen.push(e)).poll();
    appendFileSync(file, evLine('Stop'));
    const seen2: ClaudeEvent[] = [];
    new EventsWatcher(db, { file }, (e) => seen2.push(e)).poll();
    expect(seen2.map((e) => e.hook)).toEqual(['Stop']);
  });

  it('starts over when the file is truncated', () => {
    const { file, w, seen } = setup();
    writeFileSync(file, evLine('SessionStart') + evLine('UserPromptSubmit'));
    w.poll();
    writeFileSync(file, evLine('Stop'));
    w.poll();
    expect(seen.map((e) => e.hook)).toEqual(['SessionStart', 'UserPromptSubmit', 'Stop']);
  });

  it('follows a file replaced by another (new inode)', () => {
    const { dir, file, w, seen } = setup();
    writeFileSync(file, evLine('SessionStart'));
    w.poll();
    const other = path.join(dir, 'new.jsonl');
    writeFileSync(other, evLine('Stop') + evLine('SessionEnd') + evLine('SessionEnd'));
    renameSync(other, file);
    w.poll();
    expect(seen.map((e) => e.hook)).toEqual(['SessionStart', 'Stop', 'SessionEnd', 'SessionEnd']);
  });

  it('rotates the file once fully read and too large', () => {
    const { file, w, seen } = setup({ rotateBytes: 200 });
    let content = '';
    for (let i = 0; i < 5; i++) content += evLine('PreToolUse');
    writeFileSync(file, content);
    w.poll();
    expect(seen).toHaveLength(5);
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.1`, 'utf8')).toBe(content);
    // Hooks recreate the file on the next event; the watcher picks it up from the start.
    writeFileSync(file, evLine('Stop'));
    w.poll();
    expect(seen.map((e) => e.hook).at(-1)).toBe('Stop');
    expect(seen).toHaveLength(6);
  });
});
