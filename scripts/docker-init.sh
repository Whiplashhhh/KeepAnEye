#!/usr/bin/env bash
# Prépare l'installation Docker de Keep An Eye : .env, identifiants hôte, serveur tmux permanent.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { cp .env.example .env; echo "✓ .env créé depuis .env.example"; }

set_var() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
DOCKER_GID=$(getent group docker | cut -d: -f3 || true)
[ -n "$DOCKER_GID" ] || { echo "Groupe docker introuvable : Docker est-il installé ?" >&2; exit 1; }
set_var HOST_UID "$(id -u)"
set_var HOST_GID "$(id -g)"
set_var HOST_HOME "$HOME"
set_var DOCKER_GID "$DOCKER_GID"
# Fuseau horaire de l'hôte (plage « ne pas déranger », heures affichées dans les journaux).
TZ_HOST=$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo UTC)
set_var TZ "$TZ_HOST"
echo "✓ HOST_UID=$(id -u) HOST_GID=$(id -g) HOST_HOME=$HOME DOCKER_GID=$DOCKER_GID TZ=$TZ_HOST écrits dans .env"

mkdir -p data
[ -d "$HOME/claude-box" ] || echo "⚠ $HOME/claude-box n'existe pas : crée-le ou adapte compose.yml."

# Serveur tmux permanent sur l'hôte : le conteneur s'y connecte et n'en démarre jamais lui-même.
mkdir -p "$HOME/.config/systemd/user"
cp deploy/tmux-server.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now tmux-server.service
echo "✓ tmux-server.service activé (socket : /tmp/tmux-$(id -u)/default)"

if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes; then
  echo "→ Pour que tout tourne sans session ouverte : sudo loginctl enable-linger $USER"
fi
grep -q '^KAE_ALLOWED_ORIGINS=https://machine' .env && echo "→ Pense à mettre ton URL Tailscale dans KAE_ALLOWED_ORIGINS (.env)."
echo "Ensuite : docker compose up -d --build && docker compose exec keep-an-eye npm run admin:init"
