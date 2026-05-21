import type { FastifyInstance } from 'fastify';
import { getDb } from '@claudegpt/db';
import { getRedis } from '@claudegpt/queue';
import { sql } from 'drizzle-orm';

const startedAt = Date.now();

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    version: process.env.npm_package_version ?? '0.1.0',
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
  }));

  app.get('/v1/ready', async (_req, reply) => {
    const checks: Record<string, string> = {
      database: 'ok',
      queue: 'ok',
    };

    try {
      await getDb().execute(sql`select 1`);
    } catch {
      checks.database = 'error';
    }

    try {
      const ping = await getRedis().ping();
      if (ping !== 'PONG') checks.queue = 'error';
    } catch {
      checks.queue = 'error';
    }

    const anyError = Object.values(checks).some((v) => v !== 'ok');
    return reply.status(anyError ? 503 : 200).send({
      status: anyError ? 'not_ready' : 'ready',
      checks,
    });
  });
}
