import { describe, expect, it } from 'vitest';
import { MAX_EVENT_LINE_BYTES, parseEventLine, summarizeToolInput } from '../src/claude/events.js';
import { applyEvent } from '../src/claude/status.js';
import type { ClaudeEvent } from '../src/claude/events.js';

const NOW = 1_760_000_000_000;
const line = (o: Record<string, unknown>) => JSON.stringify({ KEEP_AN_EYE_SESSION: 'web', ts: NOW / 1000, ...o });

describe('parseEventLine (untrusted input)', () => {
  it('parses a normal hook event', () => {
    const ev = parseEventLine(
      line({
        hook_event_name: 'PreToolUse',
        session_id: 'abc',
        transcript_path: '/home/claude/.claude/projects/-workspace-web/abc.jsonl',
        cwd: '/workspace/web',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
      }),
      NOW,
    );
    expect(ev).toMatchObject({ session: 'web', hook: 'PreToolUse', toolName: 'Bash', toolSummary: 'npm test', ts: NOW });
  });

  it('rejects malformed JSON and non-objects', () => {
    for (const bad of ['', '{', 'null', '42', '"str"', '[]', '[{"hook_event_name":"Stop"}]', '{"a":1}garbage']) {
      expect(parseEventLine(bad, NOW)).toBeNull();
    }
  });

  it('rejects events without a valid session name', () => {
    expect(parseEventLine(JSON.stringify({ hook_event_name: 'Stop' }), NOW)).toBeNull();
    expect(parseEventLine(line({ hook_event_name: 'Stop', KEEP_AN_EYE_SESSION: '' }), NOW)).toBeNull();
    expect(parseEventLine(line({ hook_event_name: 'Stop', KEEP_AN_EYE_SESSION: '$(reboot)' }), NOW)).toBeNull();
    expect(parseEventLine(line({ hook_event_name: 'Stop', KEEP_AN_EYE_SESSION: 42 }), NOW)).toBeNull();
  });

  it('rejects unknown hook names', () => {
    expect(parseEventLine(line({ hook_event_name: 'Pwn' }), NOW)).toBeNull();
    expect(parseEventLine(line({ hook_event_name: '__proto__' }), NOW)).toBeNull();
  });

  it('rejects oversized lines', () => {
    const big = line({ hook_event_name: 'Notification', message: 'x'.repeat(MAX_EVENT_LINE_BYTES) });
    expect(parseEventLine(big, NOW)).toBeNull();
  });

  it('truncates long fields and strips control characters', () => {
    const ev = parseEventLine(line({ hook_event_name: 'Notification', message: `\u001b[31mhi\u0007${'y'.repeat(5000)}` }), NOW)!;
    expect(ev.message!.length).toBeLessThanOrEqual(2000);
    expect(ev.message!.startsWith('[31mhi')).toBe(true);
    // eslint-disable-next-line no-control-regex
    expect(ev.message).not.toMatch(/[\u0000-\u0008\u001b\u0007]/);
  });

  it('ignores wrong field types', () => {
    const ev = parseEventLine(line({ hook_event_name: 'PreToolUse', tool_name: { x: 1 }, tool_input: 'nope', cwd: 5 }), NOW)!;
    expect(ev.toolName).toBeNull();
    expect(ev.toolSummary).toBeNull();
    expect(ev.cwd).toBeNull();
  });

  it('clamps absurd timestamps to now and accepts milliseconds', () => {
    expect(parseEventLine(line({ hook_event_name: 'Stop', ts: 1e15 }), NOW)!.ts).toBe(NOW);
    expect(parseEventLine(line({ hook_event_name: 'Stop', ts: -5 }), NOW)!.ts).toBe(NOW);
    expect(parseEventLine(line({ hook_event_name: 'Stop', ts: 'soon' }), NOW)!.ts).toBe(NOW);
    expect(parseEventLine(line({ hook_event_name: 'Stop', ts: NOW - 5000 }), NOW)!.ts).toBe(NOW - 5000);
  });

  it('is not fooled by __proto__ keys', () => {
    const ev = parseEventLine('{"KEEP_AN_EYE_SESSION":"web","hook_event_name":"Stop","__proto__":{"polluted":true}}', NOW);
    expect(ev).not.toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('summarizes tool input per tool', () => {
    expect(summarizeToolInput('Edit', { file_path: '/workspace/a.ts' })).toBe('/workspace/a.ts');
    expect(summarizeToolInput('Grep', { pattern: 'TODO' })).toBe('TODO');
    expect(summarizeToolInput('Bash', null)).toBeNull();
    expect(summarizeToolInput('Bash', ['x'])).toBeNull();
  });
});

function ev(hook: ClaudeEvent['hook'], extra: Partial<ClaudeEvent> = {}): ClaudeEvent {
  return {
    session: 'web',
    hook,
    ts: NOW,
    claudeSessionId: null,
    transcriptPath: null,
    cwd: null,
    prompt: null,
    toolName: null,
    toolSummary: null,
    message: null,
    notificationType: null,
    reason: null,
    ...extra,
  };
}

describe('status reducer', () => {
  it('follows a full Claude lifecycle', () => {
    let t = applyEvent(null, ev('SessionStart'));
    expect(t.state.status).toBe('idle');
    t = applyEvent(t.state, ev('UserPromptSubmit', { prompt: 'Fix the login bug' }));
    expect(t.state.status).toBe('working');
    expect(t.activity).toContain('Fix the login bug');
    t = applyEvent(t.state, ev('PreToolUse', { toolName: 'Bash', toolSummary: 'npm test' }));
    expect(t.state.status).toBe('working');
    expect(t.state.lastMessage).toBe('Bash · npm test');
    expect(t.activity).toBeNull();
    t = applyEvent(t.state, ev('Notification', { message: 'Claude needs your permission to use Bash', notificationType: 'permission_prompt' }));
    expect(t.state.status).toBe('waiting');
    expect(t.statusChanged).toBe(true);
    t = applyEvent(t.state, ev('PreToolUse', { toolName: 'Bash' }));
    expect(t.state.status).toBe('working');
    t = applyEvent(t.state, ev('Stop'));
    expect(t.state.status).toBe('done');
    t = applyEvent(t.state, ev('SessionEnd'));
    expect(t.state.status).toBe('idle');
  });

  it('idle_prompt after Stop keeps the session "done"', () => {
    let t = applyEvent(null, ev('Stop'));
    t = applyEvent(t.state, ev('Notification', { notificationType: 'idle_prompt', message: 'Claude is waiting for your input' }));
    expect(t.state.status).toBe('done');
    expect(t.statusChanged).toBe(false);
  });

  it('StopFailure means error', () => {
    const t = applyEvent(applyEvent(null, ev('UserPromptSubmit')).state, ev('StopFailure', { message: 'API overloaded' }));
    expect(t.state.status).toBe('error');
    expect(t.state.lastMessage).toContain('API overloaded');
  });

  it('keeps transcript/cwd from earlier events', () => {
    let t = applyEvent(null, ev('SessionStart', { transcriptPath: '/home/claude/.claude/projects/x/y.jsonl', cwd: '/workspace/web' }));
    t = applyEvent(t.state, ev('Stop'));
    expect(t.state.transcriptPath).toBe('/home/claude/.claude/projects/x/y.jsonl');
    expect(t.state.cwd).toBe('/workspace/web');
  });
});
