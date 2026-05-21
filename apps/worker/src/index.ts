/**
 * @claudegpt/worker
 *
 * Process that consumes BullMQ queues and dispatches to the per-phase handlers.
 * Phase 1 stubs replaced — Phase 2-5 handlers now wired in.
 *
 * Start with: `pnpm dev:worker`
 */

import { Worker } from 'bullmq';
import { getLogger, loadEnv } from '@claudegpt/shared';
import { getRedis, QUEUE_NAMES, closeAllQueues, closeRedis } from '@claudegpt/queue';
import { closeDb, getDb } from '@claudegpt/db';
import { seedAgents } from '@claudegpt/db/seeds';

import { handleClaudeImplement } from './handlers/claude-implement.js';
import { handleClaudeRework } from './handlers/claude-rework.js';
import { handleOpenAiQa } from './handlers/openai-qa.js';
import { handleClickupSync } from './handlers/clickup-sync.js';

const log = getLogger('worker');

async function main() {
  const env = loadEnv();
  log.info({ env: env.NODE_ENV, concurrency: env.RUNNER_MAX_CONCURRENT }, 'Worker starting');

  // Seed the agents table (idempotent — uses onConflictDoUpdate keyed on name).
  // routeEvent in apps/api depends on these rows existing, so we keep this in
  // the worker boot so a single worker process is enough to bootstrap a fresh DB.
  try {
    await seedAgents(getDb());
    log.info('Agents seeded');
  } catch (err) {
    log.error({ err }, 'Failed to seed agents — worker continuing, but routeEvent will likely fail until this is resolved');
  }

  const connection = getRedis();

  const workers = [
    new Worker(
      QUEUE_NAMES.claudeImplement,
      handleClaudeImplement,
      {
        connection,
        concurrency: env.RUNNER_MAX_CONCURRENT,
        // Wall-clock per builder.md frontmatter; lockDuration must outlive the run.
        lockDuration: env.RUNNER_TIMEOUT_MINUTES * 60 * 1000 + 60_000,
      },
    ),
    new Worker(
      QUEUE_NAMES.claudeRework,
      handleClaudeRework,
      {
        connection,
        concurrency: env.RUNNER_MAX_CONCURRENT,
        lockDuration: env.RUNNER_TIMEOUT_MINUTES * 60 * 1000 + 60_000,
      },
    ),
    new Worker(
      QUEUE_NAMES.openaiQa,
      // openai-qa handler takes the data object directly; adapt to BullMQ's Job shape.
      async (job) => handleOpenAiQa(job.data as { jobId: string }),
      {
        connection,
        concurrency: 3, // docs/07 §8
        lockDuration: 10 * 60 * 1000, // 5 min cap + slack
      },
    ),
    new Worker(
      QUEUE_NAMES.clickupSync,
      handleClickupSync,
      {
        connection,
        concurrency: 5, // docs/07 §8
        lockDuration: 5 * 60 * 1000, // 2 min cap + slack
      },
    ),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) => {
      log.error({ jobId: job?.id, queue: w.name, err }, 'Worker job failed');
    });
    w.on('completed', (job) => {
      log.info({ jobId: job.id, queue: w.name }, 'Worker job completed');
    });
    w.on('error', (err) => {
      log.error({ queue: w.name, err }, 'Worker error');
    });
  }

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Worker shutdown signal');
    await Promise.all(workers.map((w) => w.close()));
    await closeAllQueues();
    await closeRedis();
    await closeDb();
    log.info('Worker shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info('Worker ready');
}

main().catch((err) => {
  log.error({ err }, 'Worker boot failed');
  process.exit(1);
});
