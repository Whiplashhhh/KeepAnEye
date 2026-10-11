import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardPaste, Copy, CornerDownLeft, WrapText } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { TerminalHandle } from './Terminal';
import { cx } from './ui';

function Key({
  label,
  onPress,
  children,
  active,
  wide,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  active?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      // preventDefault on pointerdown keeps the focus (and the virtual keyboard) on the terminal.
      onPointerDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={cx(
        'flex h-11 shrink-0 items-center justify-center rounded-md border font-mono text-[13px] font-medium transition-colors duration-100 active:scale-[0.96]',
        wide ? 'min-w-14 px-3' : 'min-w-11 px-2',
        active
          ? 'border-accent bg-accent text-on-accent'
          : 'border-line bg-surface-2 text-fg active:bg-surface-3',
      )}
    >
      {children}
    </button>
  );
}

/** Extra keys above the virtual keyboard: what phones lack for a terminal. */
export function Keybar({ term }: { term: React.RefObject<TerminalHandle | null> }) {
  const [ctrl, setCtrl] = useState(false);

  useEffect(() => {
    const onUsed = () => setCtrl(false);
    document.addEventListener('kae-ctrl-used', onUsed);
    return () => document.removeEventListener('kae-ctrl-used', onUsed);
  }, []);

  const send = (d: string) => {
    term.current?.send(d);
    if (ctrl) {
      setCtrl(false);
      term.current?.setCtrl(false);
    }
  };
  const toggleCtrl = () => {
    const next = !ctrl;
    setCtrl(next);
    term.current?.setCtrl(next);
    term.current?.focus();
  };

  return (
    <div
      role="toolbar"
      aria-label="Touches du terminal"
      className="flex gap-1.5 overflow-x-auto border-t border-line bg-elevated px-2 py-1.5 [scrollbar-width:none]"
    >
      <Key label="Échap" onPress={() => send('\x1b')} wide>
        Esc
      </Key>
      <Key label="Tabulation" onPress={() => send('\t')} wide>
        Tab
      </Key>
      <Key label="Ctrl (prochaine touche)" onPress={toggleCtrl} active={ctrl} wide>
        Ctrl
      </Key>
      <Key label="Ctrl-C (interrompre)" onPress={() => send('\x03')} wide>
        ^C
      </Key>
      <Key label="Flèche haut" onPress={() => send('\x1b[A')}>
        <ArrowUp className="size-4" />
      </Key>
      <Key label="Flèche bas" onPress={() => send('\x1b[B')}>
        <ArrowDown className="size-4" />
      </Key>
      <Key label="Entrée" onPress={() => send('\r')} wide>
        <CornerDownLeft className="size-4" />
      </Key>
      <Key label="Retour à la ligne (Maj+Entrée)" onPress={() => send('\x1b\r')}>
        <WrapText className="size-4" />
      </Key>
      <Key label="Flèche gauche" onPress={() => send('\x1b[D')}>
        <ArrowLeft className="size-4" />
      </Key>
      <Key label="Flèche droite" onPress={() => send('\x1b[C')}>
        <ArrowRight className="size-4" />
      </Key>
      <Key label="Copier la sélection" onPress={() => term.current?.copy()}>
        <Copy className="size-4" />
      </Key>
      <Key label="Coller (texte ou image)" onPress={() => void term.current?.paste()}>
        <ClipboardPaste className="size-4" />
      </Key>
    </div>
  );
}
