import { Kbd, Sheet } from './ui';

const SHORTCUTS: [string[], string][] = [
  [['Ctrl', 'K'], 'Palette de commandes'],
  [['Ctrl', 'Shift', 'K'], 'Palette, même depuis le terminal'],
  [['N'], 'Nouvelle session'],
  [['J'], 'Session suivante'],
  [['K'], 'Session précédente'],
  [['G', 'A'], 'Activité'],
  [['G', 'R'], 'Réglages'],
  [['T'], 'Basculer le thème'],
  [['Ctrl', 'C'], 'Copier la sélection (interrompt s’il n’y en a pas)'],
  [['Ctrl', 'V'], 'Coller dans le terminal (texte ou capture d’écran)'],
  [['Shift', 'Enter'], 'Retour à la ligne dans le terminal'],
  [['Esc'], 'Fermer un panneau'],
  [['?'], 'Cette aide'],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Raccourcis clavier">
      <dl className="divide-y divide-line">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="flex shrink-0 items-center gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}
