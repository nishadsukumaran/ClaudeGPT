import { buildApp } from './app.js';
import { loadEnv, getLogger } from '@claudegpt/shared';
import { closeDb } from '@claudegpt/db';
import { closeAllQueues, closeRedis } from '@claudegpt/queue';

const log = getLogger('api.server');

async function main() {
  const env = loadEnv();
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    log.info({ port: env.PORT, env: env.NODE_ENV }, 'ClaudeGPT API listening');
  } catch (err) {
    log.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutdown signal received');
    try {
      await app.close();
      await closeAllQueues();
      await closeRedis();
      await closeDb();
      log.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error({ err }, 'Unhandled error during boot');
  process.exit(1);
});
