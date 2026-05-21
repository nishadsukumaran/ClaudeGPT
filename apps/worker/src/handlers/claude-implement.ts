/**
 * Worker handler for the `claude_implement_issue` queue.
 *
 * The BullMQ job's data is `{ jobId: string }` — the actual work payload lives
 * in the agent_jobs DB row keyed by that id. Centralized worker registration
 * (apps/worker/src/index.ts) will import this function in a later phase.
 */

import type { Job } from 'bullmq';
import { runImplementation } from '@claudegpt/runner';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('worker.handler.claude-implement');

export async function handleClaudeImplement(job: Job<{ jobId: string }>): Promise<{ jobId: string }> {
  const { jobId } = job.data;
  if (!jobId) throw new Error('claude_implement_issue: missing jobId in BullMQ job data');
  log.info({ bullJobId: job.id, jobId }, 'claude_implement_issue: dispatching to runner');
  await runImplementation(jobId);
  return { jobId };
}
