// Realistic terminal contents for the demo sessions (ANSI colors included).
const R = '\x1b[0m';
const B = '\x1b[1m';
const g = (s: string) => `\x1b[32m${s}${R}`;
const y = (s: string) => `\x1b[33m${s}${R}`;
const c = (s: string) => `\x1b[36m${s}${R}`;
const m = (s: string) => `\x1b[35m${s}${R}`;
const r = (s: string) => `\x1b[31m${s}${R}`;
const gr = (s: string) => `\x1b[90m${s}${R}`;
const o = (s: string) => `\x1b[38;5;209m${s}${R}`;

export const SCREENS: Record<string, string> = {
  'api-refactor': [
    `${o('╭───────────────────────────────────────────────────╮')}`,
    `${o('│')} ${B}✻ Welcome to Claude Code!${R}                         ${o('│')}`,
    `${o('│')}   ${gr('cwd: /workspace/billing-api')}                     ${o('│')}`,
    `${o('╰───────────────────────────────────────────────────╯')}`,
    '',
    `${gr('>')} Migre le module de facturation vers le nouveau client Stripe et`,
    `  mets à jour les tests.`,
    '',
    `${g('●')} Je commence par lire le client actuel et les tests associés.`,
    '',
    `${g('●')} ${B}Read${R}(src/billing/stripe-client.ts)`,
    `  ${gr('⎿  Read 214 lines')}`,
    `${g('●')} ${B}Read${R}(test/billing/invoices.test.ts)`,
    `  ${gr('⎿  Read 388 lines')}`,
    `${g('●')} ${B}Update${R}(src/billing/stripe-client.ts)`,
    `  ${gr('⎿  Updated src/billing/stripe-client.ts with 46 additions and 31 removals')}`,
    '',
    `${g('●')} Le client est migré. Je lance la suite de tests pour vérifier.`,
    '',
    `${y('╭──────────────────────────────────────────────────────────╮')}`,
    `${y('│')} ${B}Bash command${R}                                             ${y('│')}`,
    `${y('│')}                                                          ${y('│')}`,
    `${y('│')}   npm run test -- billing                                ${y('│')}`,
    `${y('│')}   ${gr('Run the billing test suite')}                             ${y('│')}`,
    `${y('│')}                                                          ${y('│')}`,
    `${y('│')} Do you want to proceed?                                  ${y('│')}`,
    `${y('│')} ${c('❯ 1. Yes')}                                                 ${y('│')}`,
    `${y('│')}   2. Yes, and don't ask again for npm run test commands  ${y('│')}`,
    `${y('│')}   3. No, and tell Claude what to do differently (esc)    ${y('│')}`,
    `${y('╰──────────────────────────────────────────────────────────╯')}`,
  ].join('\r\n'),

  webapp: [
    `${gr('>')} Le bouton « Payer » reste actif pendant la requête, on peut`,
    `  commander deux fois. Corrige et ajoute un test.`,
    '',
    `${g('●')} Je regarde le composant Checkout.`,
    '',
    `${g('●')} ${B}Search${R}(pattern: "onSubmit", path: "src/components")`,
    `  ${gr('⎿  Found 3 files')}`,
    `${g('●')} ${B}Read${R}(src/components/Checkout.tsx)`,
    `  ${gr('⎿  Read 162 lines')}`,
    `${g('●')} ${B}Update${R}(src/components/Checkout.tsx)`,
    `  ${gr('⎿  Updated src/components/Checkout.tsx with 9 additions and 2 removals')}`,
    `     ${gr('41')}   const [submitting, setSubmitting] = useState(false);`,
    `     ${gr('42')} ${g('+ ')}${g('if (submitting) return;')}`,
    `     ${gr('43')} ${g('+ ')}${g('setSubmitting(true);')}`,
    '',
    `${m('✶')} ${m('Writing the regression test…')} ${gr('(38s · ↓ 1.2k tokens · esc to interrupt)')}`,
  ].join('\r\n'),

  'docs-site': [
    `${gr('>')} Ajoute une page « Installation » avec les étapes Ubuntu.`,
    '',
    `${g('●')} ${B}Write${R}(content/install.md)`,
    `  ${gr('⎿  Wrote 84 lines to content/install.md')}`,
    `${g('●')} ${B}Update${R}(content/_sidebar.json)`,
    `  ${gr('⎿  Updated content/_sidebar.json with 1 addition')}`,
    `${g('●')} ${B}Bash${R}(npm run build)`,
    `  ${gr('⎿  ✓ 42 pages built in 3.1s')}`,
    '',
    `${g('●')} La page Installation est en ligne dans la barre latérale, entre`,
    `  « Démarrage » et « Configuration ». Le build passe sans avertissement.`,
    '',
    `${gr('╭──────────────────────────────────────────────────────────╮')}`,
    `${gr('│')} >                                                        ${gr('│')}`,
    `${gr('╰──────────────────────────────────────────────────────────╯')}`,
    `  ${gr('? for shortcuts')}`,
  ].join('\r\n'),

  scraper: [
    `${gr('>')} Relance l'extraction des prix sur les 3 nouveaux sites.`,
    '',
    `${g('●')} ${B}Bash${R}(python -m scraper run --sites new)`,
    `  ${gr('⎿  Fetched 1 204 pages · 3 sites')}`,
    '',
    `  ${r('⎿  API Error: 529 {"type":"error","error":{"type":"overloaded_error",')}`,
    `     ${r('"message":"Overloaded"}}')}`,
    '',
    `${gr('╭──────────────────────────────────────────────────────────╮')}`,
    `${gr('│')} >                                                        ${gr('│')}`,
    `${gr('╰──────────────────────────────────────────────────────────╯')}`,
  ].join('\r\n'),

  infra: [
    `${g('moi@homelab')}:${c('~')}$ docker stats --no-stream`,
    `${B}CONTAINER   NAME         CPU %   MEM USAGE / LIMIT     NET I/O${R}`,
    `a1f3c9e0b2  claude-box   3.42%   1.21GiB / 31.2GiB     48.1MB / 9.7MB`,
    `7d02be11c4  jellyfin     0.88%   612MiB / 31.2GiB      1.2GB / 31GB`,
    `c9e4a27f50  pihole       0.12%   88MiB / 31.2GiB       24MB / 19MB`,
    `${g('moi@homelab')}:${c('~')}$ df -h /`,
    `Filesystem      Size  Used Avail Use% Mounted on`,
    `/dev/nvme0n1p2  915G  371G  498G  43% /`,
    `${g('moi@homelab')}:${c('~')}$ `,
  ].join('\r\n'),

  'shell-1': [
    `${g('moi@homelab')}:${c('~/claude-box/workspace/webapp')}$ git status -sb`,
    `## main...origin/main ${g('[ahead 2]')}`,
    ` ${r('M')} src/components/Checkout.tsx`,
    ` ${r('M')} src/components/Checkout.test.tsx`,
    `${g('moi@homelab')}:${c('~/claude-box/workspace/webapp')}$ git log --oneline -3`,
    `${y('3f9a2c1')} fix(checkout): prevent double submission`,
    `${y('b81e04d')} feat(cart): persist coupons`,
    `${y('a02c7e9')} chore: bump vite to 7.1`,
    `${g('moi@homelab')}:${c('~/claude-box/workspace/webapp')}$ `,
  ].join('\r\n'),
};

export const PROMPT_DIR: Record<string, string> = {
  infra: '~',
  'shell-1': '~/claude-box/workspace/webapp',
};
