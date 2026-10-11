import { isAdminReady } from './auth/admin.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { DockerComposeProbe } from './host/stats.js';
import { RealTmuxClient } from './tmux/client.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const db = openDb(config.dbFile);
  const app = await buildApp({
    config,
    db,
    tmux: new RealTmuxClient(config.tmuxBin, config.tmuxSocket, config.tmuxRequireServer),
    containerProbe: new DockerComposeProbe(config.dockerBin, config.claudeBoxDir),
  });
  if (!isAdminReady(db)) {
    app.fastify.log.warn('Aucun compte configuré : lance « npm run admin:init » sur le serveur.');
  }
  if (!config.allowedOrigins.some((o) => o.startsWith('https://'))) {
    app.fastify.log.warn(
      `KAE_ALLOWED_ORIGINS ne contient aucune URL https (${config.allowedOrigins.join(', ')}) : ajoute l'adresse servie par tailscale serve, sinon la connexion sera refusée.`,
    );
  }
  await app.fastify.listen({ host: config.host, port: config.port });

  const shutdown = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main();
