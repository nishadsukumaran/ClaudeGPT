/**
 * Worker handler for the `openai_qa_review` queue.
 *
 * Two modes, switched on `payload_json.mode`:
 *   - 'inbound' — ChatGPT's GitHub App posted a review; parse it via Claude
 *                 and apply the verdict.
 *   - 'timeout' — delayed timeout watcher; if no review arrived, flag for owner.
 *
 * BullMQ passes `{ jobId }` as the data payload (see packages/queue/src/queues.ts
 * `enqueueJob`). We look up the row in agent_jobs and dispatch from its payload.
 */

import { eq } from 'drizzle-orm';
import { getDb, schema } from '@claudegpt/db';
import { processInboundReview, checkQaTimeout } from '@claudegpt/qa';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('worker.openai-qa');

export interface OpenAiQaJobData {
  jobId: string;
}

export async function handleOpenAiQa(data: OpenAiQaJobData): Promise<{ mode: string; outcome: unknown }> {
  if (!data?.jobId) {
    throw new Error('openai_qa_review job is missing jobId in data payload');
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentJobs)
    .where(eq(schema.agentJobs.id, data.jobId))
    .limit(1);
  const job = rows[0];
  if (!job) throw new Error(`agent_jobs row ${data.jobId} not found`);

  const payload = (job.payloadJson ?? {}) as { mode?: 'inbound' | 'timeout' };
  const mode = payload.mode ?? 'inbound';

  log.info({ jobId: data.jobId, mode, repo: job.githubRepo, pr: job.githubPrNumber }, 'openai_qa_review dispatch');

  if (mode === 'timeout') {
    const pr = (payload as { pr?: { number?: number } }).pr;
    if (!job.githubPrNumber && !pr?.number) {
      throw new Error(`openai_qa_review timeout job ${data.jobId} has no PR number`);
    }
    const outcome = await checkQaTimeout({
      repo: job.githubRepo,
      prNumber: job.githubPrNumber ?? pr?.number ?? 0,
      scheduledAt: (payload as { timeout?: { scheduled_at?: string } }).timeout?.scheduled_at ?? new Date().toISOString(),
    });

    // Mark the timeout watcher job itself as succeeded — its purpose was to check.
    await db
      .update(schema.agentJobs)
      .set({ status: 'succeeded', completedAt: new Date() })
      .where(eq(schema.agentJobs.id, data.jobId));

    return { mode, outcome };
  }

  // Default: inbound review processing.
  const outcome = await processInboundReview({ jobId: data.jobId });
  return { mode, outcome };
}
