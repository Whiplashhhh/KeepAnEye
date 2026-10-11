# Keep An Eye — image de production.
# Le conteneur ne contient qu'un CLIENT tmux : les sessions vivent dans le serveur tmux de l'hôte
# (socket monté), elles survivent donc à l'arrêt ou à la mise à jour du conteneur.

# ---------- build ----------
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# node-pty and better-sqlite3 are native: the full image ships python3/make/g++.
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="Keep An Eye" \
      org.opencontainers.image.authors="Willem Vanbaelinghem" \
      org.opencontainers.image.description="Tour de contrôle des sessions tmux et Claude Code"
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
# Docker CLI + compose plugin (static binaries) for "docker compose ps" on claude-box.
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:27-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

WORKDIR /app
ENV NODE_ENV=production \
    DOCKER_CONFIG=/tmp/docker-config \
    npm_config_cache=/tmp/.npm \
    npm_config_update_notifier=false \
    KAE_TMUX_REQUIRE_SERVER=true
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/config ./config

# Runs as the host user (compose: user: HOST_UID:HOST_GID) so it can reach the tmux socket.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.KAE_PORT||7777)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
