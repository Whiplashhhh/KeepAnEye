import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ITheme } from '@xterm/xterm';
import { Terminal as XTerm } from '@xterm/xterm';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { wsUrl } from '../lib/live';
import { useTheme } from '../lib/theme';
import { cx } from './ui';

export type TermLink = 'connecting' | 'open' | 'reconnecting' | 'ended' | 'unavailable';

export interface TerminalHandle {
  send: (data: string) => void;
  focus: () => void;
  setCtrl: (armed: boolean) => void;
  paste: () => Promise<void>;
}

const DARK: ITheme = {
  background: '#0a0d13',
  foreground: '#d8dde7',
  cursor: '#a9a3ff',
  cursorAccent: '#0a0d13',
  selectionBackground: 'rgba(143,136,255,0.35)',
  black: '#1b2130',
  red: '#f47c7c',
  green: '#6fd99a',
  yellow: '#f5c76b',
  blue: '#76a9fa',
  magenta: '#c49cf7',
  cyan: '#5fd0e8',
  white: '#d8dde7',
  brightBlack: '#5d677c',
  brightRed: '#ff9a9a',
  brightGreen: '#8ef0b4',
  brightYellow: '#ffd98a',
  brightBlue: '#9cc2ff',
  brightMagenta: '#dab8ff',
  brightCyan: '#86e3f5',
  brightWhite: '#f4f6fa',
};

const LIGHT: ITheme = {
  background: '#fbfbfc',
  foreground: '#1d2330',
  cursor: '#5b50e6',
  cursorAccent: '#fbfbfc',
  selectionBackground: 'rgba(91,80,230,0.22)',
  black: '#1d2330',
  red: '#c62828',
  green: '#1b7f3b',
  yellow: '#9a5b00',
  blue: '#1f5fd1',
  magenta: '#8a3fc7',
  cyan: '#0b7489',
  white: '#c9ced8',
  brightBlack: '#5f6879',
  brightRed: '#d84343',
  brightGreen: '#22924a',
  brightYellow: '#b06d00',
  brightBlue: '#3a74e0',
  brightMagenta: '#9d55d6',
  brightCyan: '#13879e',
  brightWhite: '#ffffff',
};

/** xterm.js attached to a tmux session over /ws/term/:name. Reconnects automatically. */
export const Terminal = forwardRef<TerminalHandle, { session: string; onLinkChange?: (l: TermLink) => void; className?: string }>(
  function Terminal({ session, onLinkChange, className }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XTerm | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const ctrlRef = useRef(false);
    const [link, setLink] = useState<TermLink>('connecting');
    const { resolved } = useTheme();
    const linkCb = useRef(onLinkChange);
    linkCb.current = onLinkChange;

    const send = (data: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    };

    useImperativeHandle(ref, () => ({
      send,
      focus: () => termRef.current?.focus(),
      setCtrl: (armed: boolean) => {
        ctrlRef.current = armed;
      },
      paste: async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) termRef.current?.paste(text);
        } catch {
          // permission refused: nothing to do
        }
      },
    }));

    useEffect(() => {
      const el = hostRef.current;
      if (!el) return;
      const small = window.matchMedia('(max-width: 640px)').matches;
      const term = new XTerm({
        fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
        fontSize: small ? 12.5 : 13.5,
        lineHeight: 1,
        letterSpacing: 0,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        allowProposedApi: true,
        macOptionIsMeta: true,
        theme: document.documentElement.dataset.theme === 'light' ? LIGHT : DARK,
      });
      termRef.current = term;
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(
        new WebLinksAddon((_e, uri) => {
          const w = window.open(uri, '_blank', 'noopener,noreferrer');
          if (w) w.opener = null;
        }),
      );
      const unicode = new Unicode11Addon();
      term.loadAddon(unicode);
      term.unicode.activeVersion = '11';

      // Copy / paste: Ctrl+Shift+C / Ctrl+Shift+V (Ctrl+C stays the interrupt key).
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.shiftKey && e.code === 'KeyC') {
          const sel = term.getSelection();
          if (sel) void navigator.clipboard?.writeText(sel).catch(() => undefined);
          return false;
        }
        if (mod && e.shiftKey && e.code === 'KeyV') {
          void navigator.clipboard
            ?.readText()
            .then((t) => t && term.paste(t))
            .catch(() => undefined);
          return false;
        }
        if (e.metaKey && e.code === 'KeyC' && term.hasSelection()) {
          void navigator.clipboard?.writeText(term.getSelection()).catch(() => undefined);
          return false;
        }
        if (mod && e.shiftKey && e.code === 'KeyK') return false; // reserved for the command palette
        return true;
      });

      term.onData((data) => {
        let d = data;
        // Sticky Ctrl from the mobile key bar: turn the next letter into its control code.
        if (ctrlRef.current && d.length === 1) {
          const c = d.toLowerCase().charCodeAt(0);
          if (c >= 97 && c <= 122) d = String.fromCharCode(c - 96);
          else if (d === ' ') d = '\x00';
          ctrlRef.current = false;
          el.dispatchEvent(new CustomEvent('kae-ctrl-used', { bubbles: true }));
        }
        send(d);
      });

      let disposed = false;
      let retry = 0;
      let retryTimer: number | undefined;
      let opened = false;

      const update = (l: TermLink) => {
        setLink(l);
        linkCb.current?.(l);
      };

      // A hidden or collapsing container would shrink the tmux window to a few rows (and push the
      // screen into history): never report sizes that small.
      const usable = () => term.rows >= 5 && term.cols >= 20 && el.clientHeight > 60;
      const sendResize = () => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && usable()) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };

      const connect = () => {
        try {
          fit.fit();
        } catch {
          // not visible yet
        }
        const ws = new WebSocket(wsUrl(`/ws/term/${encodeURIComponent(session)}?cols=${term.cols}&rows=${term.rows}`));
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;
        ws.onopen = () => {
          opened = true;
          retry = 0;
          term.reset(); // tmux repaints the whole screen on attach
          update('open');
          sendResize();
        };
        ws.onmessage = (e) => {
          if (typeof e.data === 'string') {
            try {
              if ((JSON.parse(e.data) as { type?: string }).type === 'exit') update('ended');
            } catch {
              // ignore
            }
            return;
          }
          term.write(new Uint8Array(e.data as ArrayBuffer));
        };
        ws.onclose = (e) => {
          if (disposed) return;
          if (e.code === 1000 && e.reason === 'exit') return update('ended');
          if (e.code === 4401) return update('unavailable');
          // Refused before opening (404: the session no longer exists) after a few tries → stop.
          if (!opened && retry >= 3) return update('unavailable');
          update(opened ? 'reconnecting' : 'connecting');
          retryTimer = window.setTimeout(connect, Math.min(8000, 400 * 2 ** retry++));
        };
      };

      let ro: ResizeObserver | null = null;
      let resizeTimer: number | undefined;
      void document.fonts.load('13px "JetBrains Mono Variable"').finally(() => {
        if (disposed) return;
        term.open(el);
        try {
          fit.fit();
        } catch {
          // ignore
        }
        // Wait for a real layout (fonts measured, container sized) so tmux gets the right size at once.
        let attempts = 0;
        const start = () => {
          if (disposed) return;
          try {
            fit.fit();
          } catch {
            // not measurable yet
          }
          if (usable() || attempts++ > 30) connect();
          else window.setTimeout(start, 100);
        };
        start();
        if (!small) term.focus();
        ro = new ResizeObserver(() => {
          if (!wsRef.current) return;
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => {
            try {
              fit.fit();
              sendResize();
            } catch {
              // hidden
            }
          }, 60);
        });
        ro.observe(el);
      });

      const onOnline = () => {
        if (wsRef.current?.readyState === WebSocket.CLOSED) {
          window.clearTimeout(retryTimer);
          retry = 0;
          connect();
        }
      };
      window.addEventListener('online', onOnline);
      document.addEventListener('visibilitychange', onOnline);

      return () => {
        disposed = true;
        window.clearTimeout(retryTimer);
        window.clearTimeout(resizeTimer);
        window.removeEventListener('online', onOnline);
        document.removeEventListener('visibilitychange', onOnline);
        ro?.disconnect();
        wsRef.current?.close(1000, 'leave'); // detaches; the tmux session lives on
        term.dispose();
        termRef.current = null;
      };
    }, [session]);

    useEffect(() => {
      if (termRef.current) termRef.current.options.theme = resolved === 'light' ? LIGHT : DARK;
    }, [resolved]);

    return (
      <div className={cx('min-h-0 bg-term', className ?? 'relative')}>
        <div ref={hostRef} className="kae-terminal absolute inset-0" data-testid="terminal" />
        {(link === 'reconnecting' || link === 'connecting') && (
          <div
            role="status"
            className="pointer-events-none absolute right-3 top-3 flex animate-fade-in items-center gap-1.5 rounded-full border border-line-strong bg-elevated/90 px-2.5 py-1 text-xs font-medium text-muted backdrop-blur"
          >
            {link === 'reconnecting' ? (
              <WifiOff className="size-3.5 text-waiting" aria-hidden />
            ) : (
              <span className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
            )}
            {link === 'reconnecting' ? 'Reconnexion…' : 'Connexion…'}
          </div>
        )}
      </div>
    );
  },
);
