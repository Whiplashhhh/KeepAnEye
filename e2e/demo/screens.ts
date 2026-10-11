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
  // Claude Code redraws for the terminal width: keep the demo within ~46 columns so it fits a phone too.
  'api-refactor': [
    `${o('╭─────────────────────────────────────────╮')}`,
    `${o('│')} ${B}✻ Welcome to Claude Code!${R}               ${o('│')}`,
    `${o('│')}   ${gr('cwd: /workspace/billing-api')}           ${o('│')}`,
    `${o('╰─────────────────────────────────────────╯')}`,
    '',
    `${gr('>')} Migre le module de facturation vers le`,
    `  nouveau client Stripe et mets à jour les`,
    `  tests.`,
    '',
    `${g('●')} Je lis le client actuel et ses tests.`,
    '',
    `${g('●')} ${B}Read${R}(src/billing/stripe-client.ts)`,
    `  ${gr('⎿  Read 214 lines')}`,
    `${g('●')} ${B}Read${R}(test/billing/invoices.test.ts)`,
    `  ${gr('⎿  Read 388 lines')}`,
    `${g('●')} ${B}Update${R}(src/billing/stripe-client.ts)`,
    `  ${gr('⎿  46 additions, 31 removals')}`,
    '',
    `${g('●')} Client migré. Je lance les tests.`,
    '',
    `${y('╭─────────────────────────────────────────╮')}`,
    `${y('│')} ${B}Bash command${R}                            ${y('│')}`,
    `${y('│')}                                         ${y('│')}`,
    `${y('│')}   npm run test -- billing               ${y('│')}`,
    `${y('│')}   ${gr('Run the billing test suite')}            ${y('│')}`,
    `${y('│')}                                         ${y('│')}`,
    `${y('│')} Do you want to proceed?                 ${y('│')}`,
    `${y('│')} ${c('❯ 1. Yes')}                                ${y('│')}`,
    `${y('│')}   2. Yes, don't ask again for npm run   ${y('│')}`,
    `${y('│')}   3. No, and tell Claude what to do     ${y('│')}`,
    `${y('╰─────────────────────────────────────────╯')}`,
  ].join('\r\n'),

  webapp: [
    `${gr('>')} Le bouton « Payer » reste actif pendant`,
    `  la requête : corrige et ajoute un test.`,
    '',
    `${g('●')} Je regarde le composant Checkout.`,
    '',
    `${g('●')} ${B}Search${R}(pattern: "onSubmit")`,
    `  ${gr('⎿  Found 3 files')}`,
    `${g('●')} ${B}Read${R}(src/components/Checkout.tsx)`,
    `  ${gr('⎿  Read 162 lines')}`,
    `${g('●')} ${B}Update${R}(src/components/Checkout.tsx)`,
    `  ${gr('⎿  9 additions, 2 removals')}`,
    `     ${gr('41')}   const [busy, setBusy] = useState(false);`,
    `     ${gr('42')} ${g('+ if (busy) return;')}`,
    `     ${gr('43')} ${g('+ setBusy(true);')}`,
    '',
    `${m('✶ Writing the regression test…')}`,
    `  ${gr('38s · ↓ 1.2k tokens · esc to interrupt')}`,
  ].join('\r\n'),

  'docs-site': [
    `${gr('>')} Ajoute une page « Installation » avec les`,
    `  étapes Ubuntu.`,
    '',
    `${g('●')} ${B}Write${R}(content/install.md)`,
    `  ${gr('⎿  Wrote 84 lines')}`,
    `${g('●')} ${B}Update${R}(content/_sidebar.json)`,
    `  ${gr('⎿  1 addition')}`,
    `${g('●')} ${B}Bash${R}(npm run build)`,
    `  ${gr('⎿  ✓ 42 pages built in 3.1s')}`,
    '',
    `${g('●')} La page Installation est en ligne, entre`,
    `  « Démarrage » et « Configuration ». Le`,
    `  build passe sans avertissement.`,
    '',
    `${gr('╭─────────────────────────────────────────╮')}`,
    `${gr('│')} >                                       ${gr('│')}`,
    `${gr('╰─────────────────────────────────────────╯')}`,
    `  ${gr('? for shortcuts')}`,
  ].join('\r\n'),

  scraper: [
    `${gr('>')} Relance l'extraction des prix sur les 3`,
    `  nouveaux sites.`,
    '',
    `${g('●')} ${B}Bash${R}(python -m scraper run --sites new)`,
    `  ${gr('⎿  Fetched 1 204 pages · 3 sites')}`,
    '',
    `  ${r('⎿  API Error: 529 overloaded_error')}`,
    `     ${r('Overloaded. Retry in a few minutes.')}`,
    '',
    `${gr('╭─────────────────────────────────────────╮')}`,
    `${gr('│')} >                                       ${gr('│')}`,
    `${gr('╰─────────────────────────────────────────╯')}`,
  ].join('\r\n'),

  infra: [
    `${g('moi@homelab')}:${c('~')}$ docker ps --format '{{.Names}}\t{{.Status}}'`,
    `claude-box   Up 3 days (healthy)`,
    `jellyfin     Up 12 days`,
    `pihole       Up 12 days (healthy)`,
    `${g('moi@homelab')}:${c('~')}$ df -h /`,
    `Filesystem      Size  Used Avail Use%`,
    `/dev/nvme0n1p2  915G  371G  498G  43%`,
    `${g('moi@homelab')}:${c('~')}$ `,
  ].join('\r\n'),

  'shell-1': [
    `${g('moi@homelab')}:${c('~/…/webapp')}$ git status -sb`,
    `## main...origin/main ${g('[ahead 2]')}`,
    ` ${r('M')} src/components/Checkout.tsx`,
    ` ${r('M')} src/components/Checkout.test.tsx`,
    `${g('moi@homelab')}:${c('~/…/webapp')}$ git log --oneline -3`,
    `${y('3f9a2c1')} fix(checkout): no double submit`,
    `${y('b81e04d')} feat(cart): persist coupons`,
    `${y('a02c7e9')} chore: bump vite to 7.1`,
    `${g('moi@homelab')}:${c('~/…/webapp')}$ `,
  ].join('\r\n'),
};

export const PROMPT_DIR: Record<string, string> = {
  infra: '~',
  'shell-1': '~/…/webapp',
};
