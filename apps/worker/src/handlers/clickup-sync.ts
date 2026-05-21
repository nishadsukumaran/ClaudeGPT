/**
 * BullMQ handler for the `clickup_sync` queue.
 *
 * Central worker wiring (apps/worker/src/index.ts) is intentionally not edited
 * in this phase — it will be replaced once Phases 2-5 are all green. To wire
 * this handler in, do:
 *
 *   import { handleClickupSync } from './handlers/clickup-sync.js';
 *   new Worker(QUEUE_NAMES.clickupSync, handleClickupSync, {
 *     connection,
 *     concurrency: 5, // docs/07 §8
 *   });
 *
 * The handler is intentionally thin: it pulls the agent_jobs id out of the
 * BullMQ job data and delegates to `runSync`. Retry policy lives on the
 * queue (5 attempts, exponential, base 10s) per packages/queue/src/queues.ts.
 */

import type { Job } from 'bullmq';
import { runSync, type SyncResult } from '@claudegpt/clickup';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('worker.clickup-sync');

interface ClickupSyncJobData {
  jobId: string;
}

export async function handleClickupSync(job: Job<ClickupSyncJobData>): Promise<SyncResult> {
  const { jobId } = job.data;
  if (!jobId) {
    // Defensive: enqueueJob always sets this. If it's missing the queue is
    // mis-wired and we don't want BullMQ to keep retrying garbage.
    log.error({ bullJobId: job.id }, 'clickup_sync job missing agent_jobs.id; aborting.');
    throw new Error('clickup_sync job data missing `jobId`');
  }
  log.debug({ jobId, bullJobId: job.id, attempt: job.attemptsMade + 1 }, 'Sync handler invoked.');
  return runSync(jobId);
}

export default handleClickupSync;
