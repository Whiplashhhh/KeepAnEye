# Décisions

Une ligne par décision : décision — raison.

- Versions : TypeScript 5.9, Vite 7, Vitest 5, ESLint 9, Tailwind 4, React 19, Fastify 5 (@fastify/static 10, sans vulnérabilité connue), Playwright 1.64 — versions stables éprouvées ; Playwright aligné sur le Chromium préinstallé.
- `packages/shared` est consommé en source TypeScript ; le serveur est bundlé par esbuild — pas d'étape de build intermédiaire ni de références de projets à maintenir.
- Argon2id via `@node-rs/argon2` (binaires précompilés sur npm) — aucune compilation native requise en production.
- TOTP implémenté avec `node:crypto` (RFC 6238, SHA-1, 30 s, 6 chiffres) — quelques lignes auditables, pas de dépendance.
- L'identifiant de session n'est stocké qu'haché (SHA-256) en base — une fuite de la base ne permet pas de voler une session.
- Étape intermédiaire « mot de passe validé » portée par un cookie `kae_pre` de 5 min — le TOTP n'est jamais demandé sans mot de passe correct, et l'état reste côté serveur.
- Délai constant de 800 ms sur toutes les réponses de connexion — masque la différence entre utilisateur inexistant, mauvais mot de passe et blocage.
- Blocage progressif par IP : 5 échecs → 1 min, puis doublement jusqu'à 1 h ; blocage global après 30 échecs en 15 min — freine le brute force sans m'enfermer longtemps.
- L'IP client est lue dans `X-Forwarded-For` uniquement si la connexion vient du loopback (cas de `tailscale serve`).
- Type et projet d'une session stockés comme options utilisateur tmux (`@kae_kind`, `@kae_project`) — l'info survit au redémarrage de l'appli et reste attachée à la session.
- `window-size latest` sur les sessions créées par l'appli — le téléphone ne rétrécit pas la session vue sur le PC.
- `tmux new-session` reçoit la commande en tableau d'arguments (forme argv de tmux ≥ 3.0) — aucune interprétation par un shell.
- Modèles de session dans `config/templates.json` (surchargé par `TEMPLATES_FILE`) avec jetons `{session}`, `{project}`, `{claudeBoxDir}`, `{flags}` substitués après validation.
- Statut `Stop` → *Terminé* et la notification `idle_prompt` qui suit ne le transforme pas en *T'attend* — sinon chaque fin de tâche deviendrait une attente 60 s plus tard.
- L'appli fait elle-même la rotation de `claude.jsonl` au-delà de 5 Mo (renommage en `.1`) et détecte troncature / changement d'inode — les hooks ouvrent le fichier en ajout à chaque événement, le renommage est donc sûr.
- Lignes d'événements limitées à 64 Kio, champs texte tronqués, validation zod — données de claude-box non fiables.
- Les chemins de transcript reçus sont traduits `/home/claude` → `CLAUDE_HOME_DIR` puis vérifiés par `realpath` sous `…/.claude/projects` — pas de traversée de chemin.
- Routage frontend avec `wouter` (2 Ko) — routeur minimal suffisant.
- Service worker écrit à la main plutôt que `vite-plugin-pwa` — il ne fait que précharger l'app shell et gérer les push, tout reste lisible.
- Activité = fil des changements de statut Claude ; le journal d'audit est une sous-page de Réglages — 3 entrées de navigation maximum.
