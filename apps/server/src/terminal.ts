import { homedir } from 'node:os';
import { terminalClientMessageSchema } from '@kae/shared';
import * as pty from 'node-pty';
import type { RawData, WebSocket } from 'ws';
import type { TmuxClient } from './tmux/client.js';
import { tmuxEnv } from './tmux/client.js';

const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 128 * 1024;

/**
 * Bridges one WebSocket to a `tmux attach` running in its own pty. Each viewer gets its own tmux client,
 * so several devices can watch the same session. Closing the socket kills only that client (= detach).
 */
export function bridgeTerminal(ws: WebSocket, tmux: TmuxClient, name: string, cols: number, rows: number): void {
  const { file, args } = tmux.attachCommand(name);
  const term = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: homedir(),
    env: { ...tmuxEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'C.UTF-8' } as Record<
      string,
      string
    >,
  });

  let paused = false;
  let resumeTimer: NodeJS.Timeout | null = null;

  term.onData((data) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(Buffer.from(data, 'utf8'));
    // Backpressure: a slow phone link must not make the server buffer unbounded output.
    if (!paused && ws.bufferedAmount > HIGH_WATER) {
      paused = true;
      term.pause();
      resumeTimer = setInterval(() => {
        if (ws.bufferedAmount < LOW_WATER) {
          paused = false;
          term.resume();
          if (resumeTimer) clearInterval(resumeTimer);
          resumeTimer = null;
        }
      }, 50);
    }
  });

  term.onExit(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit' }));
      ws.close(1000, 'exit');
    }
  });

  ws.on('message', (raw: RawData, isBinary: boolean) => {
    if (isBinary) return;
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const parsed = terminalClientMessageSchema.safeParse(msg);
    if (!parsed.success) return;
    if (parsed.data.type === 'input') term.write(parsed.data.data);
    else term.resize(parsed.data.cols, parsed.data.rows);
  });

  ws.on('close', () => {
    if (resumeTimer) clearInterval(resumeTimer);
    try {
      term.kill();
    } catch {
      // already gone
    }
  });
}
