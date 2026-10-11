import { beforeEach, describe, expect, it } from 'vitest';
import { markHooked, PaneMonitor, readPane } from '../src/claude/pane.js';
import { ClaudeTracker } from '../src/claude/tracker.js';
import { FakeTmuxClient } from '../src/tmux/fake.js';
import { memDb } from './helpers.js';

describe('readPane', () => {
  it('reads busy, waiting and idle from the bottom of the pane', () => {
    expect(readPane(['✻ Réflexion… (12s · esc to interrupt)', '', '> ']).busy).toBe(true);
    const dialog = ['Bash command', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', ' Esc to cancel'];
    expect(readPane(dialog)).toEqual({ busy: false, waiting: 'Do you want to proceed?' });
    const ask = ['Quelle base de données ?', '', '❯ 1. PostgreSQL', '  2. SQLite', '  3. Type something.', 'Enter to select · Esc to cancel'];
    expect(readPane(ask)).toEqual({ busy: false, waiting: 'Quelle base de données ?' });
    const perm = ['Do you want to proceed?', '❯ 1. Yes, and don’t ask again for npm commands', '  2. Yes', '  3. No, and tell Claude what to do differently'];
    expect(readPane(perm).waiting).toBe('Do you want to proceed?');
    expect(readPane(['Voici les étapes :', '1. Installer', '2. Lancer', '> ']).waiting).toBeNull();
    // The conversation quoting the dialog's words is not a dialog.
    const quoted = ['- « Esc to cancel » dans le pied de la boîte de dialogue ;', '- « Type something » (l’option de saisie libre) ;', '❯ ', '⏵⏵ bypass permissions on'];
    expect(readPane(quoted).waiting).toBeNull();
    expect(readPane(['> ', '? for shortcuts'])).toEqual({ busy: false, waiting: null });
  });

  it('ignores old scrollback', () => {
    const old = ['esc to interrupt', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)];
    expect(readPane(old).busy).toBe(false);
  });
});

describe('PaneMonitor', () => {
  let db: ReturnType<typeof memDb>;
  let tmux: FakeTmuxClient;
  let tracker: ClaudeTracker;
  let mon: PaneMonitor;
  // The TUI redraws in place: replace the screen instead of appending.
  const screen = (...lines: string[]) => {
    tmux.sessions.get('web')!.lines = lines;
  };
  const status = () => tracker.get('web')?.status ?? 'idle';

  beforeEach(async () => {
    db = memDb();
    tmux = new FakeTmuxClient();
    tracker = new ClaudeTracker(db);
    mon = new PaneMonitor(db, tmux, tracker);
    await tmux.newSession('web', { cwd: '/', command: ['claude'], userOptions: { '@kae_kind': 'claude' } });
  });

  it('walks idle → working → waiting → working → done, with activity', async () => {
    await mon.poll();
    expect(status()).toBe('idle');
    screen('✻ Thinking… (3s · esc to interrupt)');
    await mon.poll();
    expect(status()).toBe('working');
    screen('Do you want to proceed?', '❯ 1. Yes', 'Esc to cancel');
    await mon.poll();
    expect(status()).toBe('waiting');
    expect(tracker.get('web')?.lastMessage).toBe('Do you want to proceed?');
    screen('✻ Running… (4s · esc to interrupt)');
    await mon.poll();
    expect(status()).toBe('working');
    screen('> ', '? for shortcuts');
    await mon.poll();
    expect(status()).toBe('working'); // one quiet reading is not enough
    await mon.poll();
    expect(status()).toBe('done');
    expect(tracker.activity().map((a) => a.status)).toEqual(['done', 'waiting', 'working']);
  });

  it('leaves sessions alone once a real hook event arrived', async () => {
    markHooked(db, 'web');
    screen('✻ Thinking… (3s · esc to interrupt)');
    await mon.poll();
    expect(status()).toBe('idle');
  });
});
