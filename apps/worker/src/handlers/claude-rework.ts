/**
 * Worker handler for the `claude_rework_pr` queue.
 *
 * The BullMQ job's data is `{ jobId: string }` — the actual work payload lives
 * in the agent_jobs DB row keyed by that id. Centralized worker registration
 * (apps/worker/src/index.ts) will import this function in a later phase.
 */

import type { Job } from 'bullmq';
import { runRework } from '@claudegpt/runner';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('worker.handler.claude-rework');

export async function handleClaudeRework(job: Job<{ jobId: string }>): Promise<{ jobId: string }> {
  const { jobId } = job.data;
  if (!jobId) throw new Error('claude_rework_pr: missing jobId in BullMQ job data');
  log.info({ bullJobId: job.id, jobId }, 'claude_rework_pr: dispatching to runner');
  await runRework(jobId);
  return { jobId };
}
