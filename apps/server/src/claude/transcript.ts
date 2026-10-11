import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Timeline, TimelineItem } from '@kae/shared';
import { summarizeToolInput } from './events.js';

const CONTAINER_HOME = '/home/claude/';
const TAIL_BYTES = 512 * 1024;
const MAX_ITEMS = 200;
const MAX_TEXT = 4000;
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * Maps a transcript path reported by claude-box (container path) to the host, and checks it stays
 * inside <claudeHomeDir>/.claude/projects after resolving symlinks. Returns null if anything is off.
 */
export function resolveTranscriptPath(reported: string | null, claudeHomeDir: string): string | null {
  if (!reported || !reported.startsWith(CONTAINER_HOME) || !reported.endsWith('.jsonl')) return null;
  const rel = reported.slice(CONTAINER_HOME.length);
  if (rel.split('/').some((seg) => seg === '..' || seg === '')) return null;
  try {
    const root = realpathSync(path.join(claudeHomeDir, '.claude', 'projects'));
    const real = realpathSync(path.join(claudeHomeDir, rel));
    if (!real.startsWith(root + path.sep)) return null;
    if (!statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

function clip(s: string, max = MAX_TEXT): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function tsOf(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' ? String((c as { text?: unknown }).text ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Parses transcript JSONL text (untrusted) into timeline items. */
export function parseTranscript(text: string): Omit<Timeline, 'available'> {
  const items: TimelineItem[] = [];
  const files = new Set<string>();
  let lastAssistant: string | null = null;

  for (const line of text.split('\n')) {
    if (!line || line.length > 2 * 1024 * 1024) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    const entry = o as { type?: unknown; timestamp?: unknown; isMeta?: unknown; message?: { content?: unknown } };
    const ts = tsOf(entry.timestamp);
    const content = entry.message?.content;
    if (entry.isMeta === true) continue;

    if (entry.type === 'user') {
      if (typeof content === 'string') {
        // Skip slash-command plumbing and local command echoes.
        if (!content.startsWith('<') && content.trim()) items.push({ kind: 'user', ts, text: clip(content.trim()) });
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (!c || typeof c !== 'object') continue;
        const block = c as { type?: unknown; text?: unknown; content?: unknown; is_error?: unknown };
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() && !block.text.startsWith('<')) {
          items.push({ kind: 'user', ts, text: clip(block.text.trim()) });
        } else if (block.type === 'tool_result' && block.is_error === true) {
          const t = textOf(block.content) || 'Échec de l’outil';
          items.push({ kind: 'result', ts, text: clip(t.trim(), 600), isError: true });
        }
      }
    } else if (entry.type === 'assistant' && Array.isArray(content)) {
      for (const c of content) {
        if (!c || typeof c !== 'object') continue;
        const block = c as { type?: unknown; text?: unknown; name?: unknown; input?: unknown };
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          const t = clip(block.text.trim());
          items.push({ kind: 'assistant', ts, text: t });
          lastAssistant = t;
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          const tool = clip(block.name, 80);
          const summary = summarizeToolInput(tool, block.input) ?? '';
          items.push({ kind: 'tool', ts, tool, summary: clip(summary, 300) });
          if (FILE_TOOLS.has(tool) && summary) files.add(clip(summary, 300));
        }
      }
    }
  }
  return { items: items.slice(-MAX_ITEMS), filesTouched: [...files].slice(-50), lastAssistant };
}

/** Reads the tail of a transcript file (read-only). */
export function readTimeline(reported: string | null, claudeHomeDir: string): Timeline {
  const file = resolveTranscriptPath(reported, claudeHomeDir);
  if (!file) {
    return {
      available: false,
      reason: reported ? 'Transcript introuvable ou hors du dossier autorisé.' : 'Aucun transcript pour cette session.',
      items: [],
      filesTouched: [],
      lastAssistant: null,
    };
  }
  const size = statSync(file).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = openSync(file, 'r');
  let text: string;
  try {
    const buf = Buffer.alloc(size - start);
    const n = readSync(fd, buf, 0, buf.length, start);
    text = buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
  if (start > 0) text = text.slice(text.indexOf('\n') + 1); // drop the partial first line
  return { available: true, ...parseTranscript(text) };
}
