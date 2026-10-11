import { closeSync, openSync, readSync, renameSync, statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { DB } from '../db.js';
import { kvGet, kvSet } from '../db.js';
import type { ClaudeEvent } from './events.js';
import { MAX_EVENT_LINE_BYTES, parseEventLine } from './events.js';

export interface WatcherOptions {
  file: string;
  /** Rotate (rename to `<file>.1`) once fully read and larger than this. */
  rotateBytes?: number;
  pollMs?: number;
  /** Max bytes read per tick, so a huge backlog never blocks the event loop. */
  chunkBytes?: number;
  now?: () => number;
}

interface Position {
  ino: number;
  offset: number;
}

const KV_KEY = 'events.position';

/**
 * Tails the hook events file written by claude-box. Handles truncation, replacement (new inode),
 * partial lines and its own rotation. The read position survives restarts (stored in the kv table).
 */
export class EventsWatcher {
  private timer: NodeJS.Timeout | null = null;
  private pending = '';
  // Persistent decoder: a multi-byte character split across two reads is decoded correctly.
  private decoder = new StringDecoder('utf8');
  private readonly rotateBytes: number;
  private readonly chunkBytes: number;
  private readonly now: () => number;

  constructor(
    private readonly db: DB,
    private readonly opts: WatcherOptions,
    private readonly onEvent: (ev: ClaudeEvent) => void,
  ) {
    this.rotateBytes = opts.rotateBytes ?? 5 * 1024 * 1024;
    this.chunkBytes = opts.chunkBytes ?? 1024 * 1024;
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    this.poll();
    this.timer = setInterval(() => this.poll(), this.opts.pollMs ?? 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One polling step (public for tests). Never throws. */
  poll(): void {
    try {
      this.step();
    } catch {
      // Missing file, permission problem…: try again next tick.
    }
  }

  private step(): void {
    let st;
    try {
      st = statSync(this.opts.file);
    } catch {
      return;
    }
    let pos = kvGet<Position>(this.db, KV_KEY) ?? { ino: st.ino, offset: 0 };
    if (pos.ino !== st.ino || st.size < pos.offset) {
      // Replaced or truncated: start over on the new content.
      pos = { ino: st.ino, offset: 0 };
      this.pending = '';
      this.decoder = new StringDecoder('utf8');
    }
    // Read whatever is available, chunk by chunk (bounded per tick).
    let budget = this.chunkBytes * 4;
    while (pos.offset < st.size && budget > 0) {
      const read = this.readFrom(this.opts.file, pos.offset, Math.min(this.chunkBytes, st.size - pos.offset));
      pos.offset += read;
      budget -= read;
      if (read === 0) break;
    }
    kvSet(this.db, KV_KEY, pos);

    if (pos.offset >= st.size && st.size > this.rotateBytes) this.rotate(pos);
  }

  private rotate(pos: Position): void {
    const rotated = `${this.opts.file}.1`;
    renameSync(this.opts.file, rotated);
    // Anything appended between our last read and the rename landed in the rotated file: drain it.
    try {
      const st = statSync(rotated);
      if (st.size > pos.offset) this.readFrom(rotated, pos.offset, st.size - pos.offset);
    } catch {
      // ignore
    }
    this.flushPending();
    kvSet(this.db, KV_KEY, { ino: -1, offset: 0 });
  }

  /** Reads `length` bytes at `offset`, feeds complete lines, keeps the trailing partial line. Returns bytes read. */
  private readFrom(file: string, offset: number, length: number): number {
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      const n = readSync(fd, buf, 0, length, offset);
      this.feed(this.decoder.write(buf.subarray(0, n)));
      return n;
    } finally {
      closeSync(fd);
    }
  }

  private feed(text: string): void {
    const data = this.pending + text;
    const lines = data.split('\n');
    this.pending = lines.pop() ?? '';
    // A "line" that never ends is garbage: drop it instead of growing forever.
    if (this.pending.length > MAX_EVENT_LINE_BYTES) this.pending = '';
    for (const line of lines) this.handleLine(line);
  }

  private flushPending(): void {
    if (this.pending) this.handleLine(this.pending);
    this.pending = '';
  }

  private handleLine(line: string): void {
    const ev = parseEventLine(line.trim(), this.now());
    if (ev) this.onEvent(ev);
  }
}
