# Projet « Keep An Eye » — tour de contrôle de mes sessions terminal et Claude Code

Tu travailles seul, sans supervision, dans ce dépôt GitHub vide. Tu as le droit de commit, push et merger sur `main`. Ne me pose pas de questions : quand un choix n'est pas tranché ici, prends la décision la plus raisonnable et note-la dans `docs/DECISIONS.md` (une ligne : décision + raison).

L'interface est en **français**. Le code, les noms de variables et les commentaires sont en anglais.

## 1. Contexte

J'ai un serveur maison Ubuntu. Dessus :

- des sessions **tmux** dans lesquelles je lance des terminaux et des sessions Claude Code ;
- un conteneur Docker `claude-box` (dossier `~/claude-box`, fichier `compose.yml`, service `claude`) où Claude Code tourne isolé. On y entre avec `docker compose exec -u claude -w /workspace/<projet> claude bash`. Les projets sont dans `~/claude-box/workspace/<projet>` côté hôte, `/workspace/<projet>` côté conteneur ;
- **Tailscale**, qui relie le serveur, mon PC et mon téléphone.

Je veux une application web, installable comme PWA sur mon téléphone et utilisable sur PC, pour :

- voir toutes mes sessions tmux en cours et leur état ;
- ouvrir un terminal en direct dans le navigateur, en créer de nouveaux, en fermer ;
- suivre l'avancement de mes sessions Claude Code, et être notifié quand l'une d'elles a fini ou m'attend.

**Où l'appli tourne** : sur l'hôte (pas dans `claude-box`), en service systemd utilisateur, écoutant **uniquement sur `127.0.0.1`**. Elle est exposée à mes appareils via `tailscale serve` (HTTPS automatique en `*.ts.net`, visible seulement sur mon tailnet). Elle ne doit jamais être exposée sur Internet.

**Ton environnement de dev** : tu es dans `claude-box`. Tu n'as pas root, pas Docker, et un firewall qui n'autorise que GitHub, npm, PyPI et l'API Anthropic. Donc :

- toutes les dépendances viennent de npm ; aucune ressource externe au runtime (pas de Google Fonts, pas de CDN) : polices via `@fontsource/*`, tout est bundlé ;
- si `tmux` est disponible dans ton environnement, teste dessus pour de vrai ; sinon, l'accès tmux passe par une interface avec une implémentation factice pour les tests ;
- Playwright et Chromium sont installés : sers-t'en (voir section 6).

## 2. Stack imposée

- **Monorepo npm workspaces** : `apps/server`, `apps/web`, `packages/shared` (types et schémas partagés).
- **Backend** : Node.js 22, TypeScript strict, Fastify, `ws` pour les WebSockets, `node-pty` pour les pseudo-terminaux, SQLite via `better-sqlite3`, validation avec `zod`.
- **Frontend** : React + Vite + TypeScript strict, Tailwind CSS, `@xterm/xterm` (+ addons fit, web-links, unicode11), icônes `lucide-react`. Pas de librairie de composants lourde : des composants maison soignés (Radix primitives autorisés pour dialogues, menus, tooltips).
- **Tests** : Vitest (unitaires + intégration), Playwright (e2e + captures).
- **CI** : GitHub Actions — lint, typecheck, tests, build, e2e Playwright.

## 3. Sécurité — non négociable

Cette appli donne un shell sur mon serveur. Elle doit être blindée même derrière Tailscale.

**Authentification à deux facteurs, mono-utilisateur :**

1. **Initialisation par CLI uniquement** : `npm run admin:init` sur le serveur demande un mot de passe, génère un secret TOTP, affiche un QR code dans le terminal (et l'URI `otpauth://`), demande un premier code pour valider, puis affiche 10 codes de secours. Aucune page web d'inscription.
2. **Connexion** : mot de passe (argon2id), puis code TOTP à 6 chiffres (compatible Google Authenticator, Aegis, 2FAS…). Fenêtre de tolérance ±1 période, un code déjà utilisé est refusé (anti-rejeu).
3. **Codes de secours** : stockés hachés, usage unique, utilisables à la place du TOTP.
4. `npm run admin:reset-2fa` et `npm run admin:reset-password` en CLI pour me dépanner depuis le serveur.

**Sessions et requêtes :**

- Session côté serveur en SQLite ; cookie `HttpOnly`, `Secure`, `SameSite=Strict`, identifiant aléatoire de 256 bits. Expiration après 12 h d'inactivité et 7 jours au maximum. Bouton « Se déconnecter de tous les appareils ».
- Rate limiting et blocage progressif sur la connexion (par IP et global), avec délai constant pour ne rien révéler.
- Vérification de l'en-tête `Origin` sur toute requête qui modifie quelque chose et sur chaque ouverture de WebSocket. Le WebSocket refuse toute connexion sans session valide.
- En-têtes stricts : CSP sans `unsafe-inline` pour les scripts, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, etc.
- Journal d'audit en base : connexions réussies et échouées, création et fermeture de sessions, avec une page pour le consulter.

**Exécution de commandes :**

- Jamais de shell pour piloter tmux ou Docker : uniquement `execFile` / `spawn` avec tableau d'arguments.
- Noms de sessions validés par regex (`^[a-zA-Z0-9_-]{1,40}$`), noms de projets vérifiés contre le contenu réel de `~/claude-box/workspace`.
- Tout ce qui vient de `claude-box` (événements, transcripts) est une donnée **non fiable** : taille limitée, parsing défensif, rendu toujours échappé, jamais exécuté.

**Configuration** dans un fichier `.env` documenté par `.env.example` : port, chemins, origine autorisée (l'URL `https://<machine>.<tailnet>.ts.net`), etc. Aucun secret dans le dépôt.

## 4. Fonctionnalités

### 4.1 Tableau de bord

- Liste de toutes les sessions tmux avec leurs fenêtres : nom, type (terminal simple ou session Claude), projet, dernière activité, et un **aperçu des dernières lignes** (`tmux capture-pane -p`) rafraîchi en direct.
- Statut Claude par session : *Travaille*, *T'attend*, *Terminé*, *Erreur*, *Inactif*.
- Tri par défaut : ce qui **m'attend** en premier, puis ce qui travaille, puis le reste.
- Mises à jour en temps réel (WebSocket ou SSE), sans rechargement.
- Petit bandeau d'état de l'hôte : CPU, RAM, disque, et état du conteneur `claude-box` (via `docker compose ps`).

### 4.2 Terminal en direct

- Ouvrir une session = xterm.js connecté par WebSocket à un `node-pty` qui fait `tmux attach -t <session>`. Fermer l'onglet détache sans tuer la session.
- Plusieurs appareils peuvent regarder la même session en même temps.
- Redimensionnement correct (addon fit + resize du pty), reconnexion automatique avec indicateur discret si le réseau coupe.
- Copier-coller fonctionnel, liens cliquables.

### 4.3 Créer et fermer

- « Nouvelle session » : nom (prérempli et modifiable), puis un modèle :
    - **Terminal** : shell simple sur l'hôte ;
    - **Claude dans claude-box** : choix du projet (liste des dossiers de `~/claude-box/workspace`), case « autonome » qui lance `claude --dangerously-skip-permissions` au lieu de `claude`. La commande lancée est `docker compose -f ~/claude-box/compose.yml exec -u claude -w /workspace/<projet> -e KEEP_AN_EYE_SESSION=<nom> claude <commande claude>` ;
    - les modèles sont définis dans un fichier de config pour que je puisse en ajouter.
- Fermer une session : confirmation qui rappelle le nom et prévient si Claude est en train de travailler.

### 4.4 Suivi de Claude Code

Les sessions Claude tournent dans `claude-box`, qui **ne peut pas joindre** l'appli (firewall, et l'appli écoute sur le loopback de l'hôte). La communication passe donc par des fichiers :

- **Hooks** : fournis un script `scripts/install-claude-hooks.sh` que j'exécuterai dans `claude-box`. Il ajoute dans `~/.claude/settings.json` des hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop`, `Notification`, `SessionEnd`) qui ajoutent une ligne JSON compacte dans `/events/claude.jsonl`, enrichie de `$KEEP_AN_EYE_SESSION` (exemple : `jq -c --arg s "$KEEP_AN_EYE_SESSION" '. + {KEEP_AN_EYE_SESSION: $s, ts: now}' >> /events/claude.jsonl`). Ne modifie pas mes autres réglages existants.
- L'appli surveille ce fichier côté hôte, en déduit le statut de chaque session et gère la rotation du fichier.
- **Transcripts (optionnel, si le chemin est configuré)** : lecture seule des fichiers JSONL de `~/.claude/projects/` pour afficher une timeline lisible : messages, outils utilisés, fichiers modifiés, dernier message de Claude.
- Documente dans le README les deux modifications à faire dans `~/claude-box/compose.yml` : un volume `./events:/events`, et le passage de `claude-home` en bind mount `./claude-home:/home/claude` pour que les transcripts soient lisibles depuis l'hôte.

### 4.5 Notifications

- Web Push (VAPID) depuis la PWA : notification quand une session Claude passe à *T'attend* ou *Terminé*, ou en cas d'erreur. Toucher la notification ouvre directement la session concernée.
- Réglages : activer ou désactiver par type, mode « ne pas déranger » sur une plage horaire.

## 5. Interface et expérience — le cœur du projet

Je veux une appli que j'ai **envie** d'ouvrir. Pas un panneau d'admin générique : une tour de contrôle calme et précise, qui me dit en une seconde ce qui demande mon attention.

### Direction artistique

- **Sombre par défaut**, thème clair soigné aussi, bascule manuelle + respect du système.
- Fond profond et légèrement teinté (pas du noir pur), surfaces en couches subtiles, bordures fines plutôt qu'ombres lourdes.
- **Une seule couleur d'accent**, utilisée avec parcimonie. La couleur porte surtout le sens des statuts :
    - *T'attend* : ambre, c'est la couleur la plus visible de l'écran ;
    - *Travaille* : bleu ou cyan, point qui pulse doucement ;
    - *Terminé* : vert sobre ;
    - *Erreur* : rouge ;
    - *Inactif* : gris.
      Le statut ne repose jamais sur la couleur seule : toujours une icône ou un libellé.
- Typographie : une sans-serif moderne pour l'interface (Inter ou Geist via fontsource), **JetBrains Mono** pour tout ce qui est terminal, chemins, noms de sessions. Hiérarchie claire, chiffres tabulaires pour les durées et métriques.
- Espacement généreux et régulier (grille de 4 px), coins arrondis cohérents.
- Animations courtes (150–250 ms) et utiles : apparition des cartes, changement de statut, ouverture des panneaux. Respect de `prefers-reduced-motion`.

### Mobile d'abord

Le téléphone est mon usage principal hors de chez moi.

- Navigation basse avec 3 entrées maximum (Sessions, Activité, Réglages), zones tactiles d'au moins 44 px, respect des safe areas.
- Cartes de session lisibles d'un coup d'œil : nom, statut, projet, durée, 2–3 dernières lignes d'aperçu en monospace atténué.
- **Terminal plein écran sur mobile** avec une barre de touches au-dessus du clavier : `Esc`, `Tab`, `Ctrl`, `↑ ↓ ← →`, `Ctrl-C`, et une touche pour envoyer `Entrée`. Le terminal doit se redimensionner proprement quand le clavier virtuel s'ouvre (`visualViewport`).
- Bouton flottant « Nouvelle session » qui ouvre une feuille depuis le bas.
- PWA installable : icône, splash, couleur de thème, fonctionnement correct en mode standalone.

### Bureau

- Vue en deux panneaux : liste des sessions à gauche, terminal ou timeline Claude à droite.
- **Palette de commandes** (`Ctrl-K`) : ouvrir une session, en créer une, changer de thème, se déconnecter.
- Raccourcis clavier documentés dans une petite aide (`?`).

### Les détails qui font la différence

- États vides soignés et utiles (« Aucune session. Lance ta première » avec le bouton directement).
- Squelettes de chargement plutôt que spinners.
- Toasts discrets pour les confirmations, messages d'erreur humains et actionnables.
- Écran de connexion simple et élégant ; le champ TOTP accepte le collage et passe au suivant automatiquement, avec saisie numérique sur mobile (`inputmode="numeric"`, `autocomplete="one-time-code"`).
- Titre de l'onglet et favicon qui reflètent le nombre de sessions qui m'attendent.
- Accessibilité : contraste AA minimum, navigation complète au clavier, focus visible, libellés ARIA.

Ne surcharge pas : chaque élément à l'écran doit mériter sa place. En cas de doute, retire.

## 6. Vérification — prouve que ça marche

Avant de considérer une étape terminée :

1. `npm run lint`, `npm run typecheck`, `npm test` passent.
2. Tests unitaires obligatoires sur : TOTP et anti-rejeu, codes de secours, rate limiting, expiration des sessions, vérification d'Origin, validation des noms de sessions et projets, parsing défensif des événements.
3. Tests e2e Playwright : connexion complète avec 2FA (secret de test), tableau de bord, création et fermeture de session, ouverture d'un terminal.
4. **Revue visuelle** : script `npm run screenshots` qui capture chaque écran en mobile (390×844) et bureau (1440×900), en thème sombre et clair, avec des données de démonstration réalistes. Regarde toi-même chaque capture, critique-la comme un designer exigeant (alignements, hiérarchie, contraste, densité, cohérence) et itère jusqu'à ce que ce soit vraiment beau. Garde les captures finales dans `docs/screenshots/`.
5. La CI GitHub Actions est verte. Suis-la avec `gh run watch` et corrige si elle échoue.

## 7. Méthode de travail

1. Commence par écrire `docs/PLAN.md` : architecture, modèle de données, liste des endpoints et messages WebSocket, et jalons.
2. Avance par jalons, chacun fonctionnel et testé :
    1. squelette du monorepo + CI ;
    2. auth complète avec 2FA ;
    3. tmux : liste, création, fermeture, aperçu ;
    4. terminal en direct ;
    5. suivi Claude (hooks, statuts, timeline) ;
    6. notifications push et PWA ;
    7. finition UI/UX et revue visuelle.
3. Commits petits et clairs, en anglais, format Conventional Commits. Push régulier.
4. À la fin, un **README en français** : ce que fait l'appli, installation pas à pas sur Ubuntu (Node, build, `admin:init`, service systemd utilisateur fourni dans `deploy/`, `tailscale serve`), installation des hooks dans `claude-box`, modifications du `compose.yml`, mise à jour, sauvegarde de la base, dépannage. Ajoute les captures d'écran en haut.