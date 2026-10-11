# Keep An Eye — plan

Tour de contrôle web (PWA) pour les sessions tmux et Claude Code d'un serveur maison.

## Architecture

```
 téléphone / PC ──HTTPS (tailnet)──► tailscale serve ──HTTP──► 127.0.0.1:7777  (Keep An Eye, service systemd utilisateur)
                                                                   │
                     ┌─────────────────────────────────────────────┼──────────────────────────────┐
                     │ Fastify (REST /api/*)    ws (/ws/live, /ws/term/:name)   static (apps/web/dist)│
                     │      │                        │                    │                         │
                     │   SQLite (better-sqlite3)   node-pty ── tmux attach -t <name>                 │
                     │   sessions, audit, push,   TmuxClient (execFile tmux …)                       │
                     │   claude_state, settings   ClaudeWatcher ── tail ~/claude-box/events/claude.jsonl
                     │                            Transcripts ── lecture seule ~/claude-box/claude-home/.claude/projects
                     │                            HostStats (os, statfs) + docker compose ps (execFile) │
                     └──────────────────────────────────────────────────────────────────────────────┘
 claude-box (Docker) ── hooks Claude Code ──► /events/claude.jsonl (bind mount ./events)
```

Monorepo npm workspaces :

| Paquet | Rôle |
|---|---|
| `packages/shared` | Schémas `zod` et types partagés (API, messages WebSocket, statuts). Consommé en source TS. |
| `apps/server` | Fastify + ws + node-pty + better-sqlite3. Bundlé par esbuild (`dist/index.js`, `dist/cli.js`). |
| `apps/web` | React + Vite + Tailwind v4 + xterm.js. PWA (manifest + service worker maison). |

Tout passe par des interfaces injectables (`TmuxClient`, `DockerProbe`, horloge) pour les tests :
une implémentation réelle (`execFile`, jamais de shell) et une factice.

## Modèle de données (SQLite)

| Table | Colonnes principales |
|---|---|
| `admin` | `id=1`, `password_hash` (argon2id), `totp_secret` (base32), `totp_last_step` (anti-rejeu), `created_at` |
| `recovery_codes` | `id`, `code_hash` (sha256 + sel), `used_at` |
| `sessions` | `id_hash` (sha256 de l'identifiant 256 bits), `created_at`, `last_seen_at`, `ip`, `user_agent` |
| `preauth` | `id_hash`, `created_at`, `ip` (étape mot de passe validée, 5 min) |
| `audit_log` | `id`, `ts`, `event`, `ip`, `user_agent`, `detail` (JSON) |
| `claude_state` | `session` (nom tmux), `status`, `claude_session_id`, `cwd`, `transcript_path`, `last_event`, `last_message`, `updated_at` |
| `activity` | `id`, `ts`, `session`, `kind`, `status`, `text` (fil d'activité) |
| `push_subscriptions` | `endpoint` (PK), `p256dh`, `auth`, `created_at`, `user_agent` |
| `kv` | `key`, `value` (clés VAPID, offset du fichier d'événements, réglages notifications) |

## API REST

Toutes les routes `/api/*` sauf `health` et `auth/*` exigent une session valide.
Toute méthode autre que `GET`/`HEAD` exige un en-tête `Origin` autorisé.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/health` | Vivacité (public) |
| GET | `/api/auth/me` | `{ authenticated, stage }` |
| POST | `/api/auth/password` | Étape 1 → cookie `kae_pre` |
| POST | `/api/auth/second-factor` | Étape 2 (TOTP ou code de secours) → cookie `kae_sid` |
| POST | `/api/auth/logout` | Ferme la session courante |
| POST | `/api/auth/logout-all` | Ferme toutes les sessions |
| GET | `/api/sessions` | Sessions tmux + fenêtres + aperçu + statut Claude |
| POST | `/api/sessions` | Crée une session depuis un modèle |
| DELETE | `/api/sessions/:name` | Ferme une session |
| GET | `/api/sessions/:name/timeline` | Timeline Claude (transcript) |
| GET | `/api/templates` | Modèles de session |
| GET | `/api/projects` | Dossiers de `~/claude-box/workspace` |
| GET | `/api/host` | CPU, RAM, disque, conteneur |
| GET | `/api/activity` | Fil d'activité Claude |
| GET | `/api/audit` | Journal d'audit |
| GET/PUT | `/api/settings/notifications` | Types activés, ne pas déranger |
| GET | `/api/push/key` | Clé publique VAPID |
| POST | `/api/push/subscribe` · `/api/push/unsubscribe` · `/api/push/test` | Abonnements Web Push |

## WebSockets

`/ws/live` (session + Origin vérifiés à l'ouverture) — serveur → client, JSON :

- `{ type: "sessions", sessions: SessionInfo[] }` — instantané complet à chaque changement ;
- `{ type: "host", host: HostInfo }` — toutes les 5 s ;
- `{ type: "activity", item: ActivityItem }` — nouvel événement Claude ;
- `{ type: "bye", reason }` — session expirée.

`/ws/term/:name?cols=&rows=` — terminal :

- serveur → client : trames binaires = sortie brute du pty ; texte JSON `{ type: "exit" }` ;
- client → serveur : texte JSON `{ type: "input", data }` ou `{ type: "resize", cols, rows }`.

## Statuts Claude

Dérivés des hooks (`hook_event_name`) : `SessionStart` → *Inactif* ; `UserPromptSubmit`, `PreToolUse` → *Travaille* ;
`Notification` → *T'attend* (sauf `idle_prompt` après un `Stop`) ; `Stop` → *Terminé* ; `StopFailure` / panneau mort en erreur → *Erreur* ;
`SessionEnd` → *Inactif*.

## Jalons

1. Squelette du monorepo + CI (lint, typecheck, tests, build, e2e).
2. Auth complète avec 2FA (CLI admin, mot de passe argon2id, TOTP anti-rejeu, codes de secours, sessions, rate limiting, Origin, en-têtes, audit).
3. tmux : liste, création, fermeture, aperçu.
4. Terminal en direct (node-pty + xterm.js, multi-appareils, reconnexion, barre de touches mobile).
5. Suivi Claude (hooks, surveillance du fichier, statuts, timeline).
6. Notifications Web Push et PWA.
7. Finition UI/UX, captures et revue visuelle, README.
