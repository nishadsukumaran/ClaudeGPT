/**
 * QA timeout watcher.
 *
 * Scheduled (delayed) BullMQ job. Fires N minutes after a Claude PR opens. If
 * no ChatGPT review has landed (no agent_runs.status='succeeded' for an
 * openai_qa_review against this PR), apply `blocked` + `needs-nishad` so the
 * operator picks it up manually.
 */

import { eq, and, desc } from 'drizzle-orm';
import { getDb, schema } from '@claudegpt/db';
import { addLabels, commentOnIssue } from '@claudegpt/github';
import { getLogger } from '@claudegpt/shared';

const log = getLogger('qa.timeout');

export interface TimeoutWatcherArgs {
  repo: string;
  prNumber: number;
  /** Set when scheduled, used for log correlation. */
  scheduledAt: string;
}

export async function checkQaTimeout(args: TimeoutWatcherArgs): Promise<{ action: 'no_op' | 'flagged' }> {
  const { repo, prNumber } = args;
  const db = getDb();

  // Look for a succeeded openai_qa_review job for this repo/PR.
  const recentJobs = await db
    .select()
    .from(schema.agentJobs)
    .where(
      and(
        eq(schema.agentJobs.githubRepo, repo),
        eq(schema.agentJobs.githubPrNumber, prNumber),
        eq(schema.agentJobs.jobType, 'openai_qa_review'),
      ),
    )
    .orderBy(desc(schema.agentJobs.createdAt))
    .limit(5);

  const succeeded = recentJobs.find((j) => j.status === 'succeeded');
  if (succeeded) {
    log.info({ repo, prNumber, jobId: succeeded.id }, 'QA verdict already recorded; timeout no-op');
    return { action: 'no_op' };
  }

  // Also check if there's a fresh job already running (review arrived but still parsing).
  const running = recentJobs.find((j) => j.status === 'running' || j.status === 'queued');
  if (running) {
    log.info({ repo, prNumber, jobId: running.id }, 'QA job in progress; timeout no-op');
    return { action: 'no_op' };
  }

  // No review, no in-progress job — flag for owner.
  log.warn({ repo, prNumber }, 'QA timeout: no ChatGPT review received');

  try {
    await commentOnIssue(
      repo,
      prNumber,
      'ClaudeGPT: no ChatGPT review received within the timeout window. Flagging for owner review.',
    );
  } catch (err) {
    log.warn({ err, repo, prNumber }, 'Failed to post timeout comment (continuing)');
  }

  try {
    await addLabels(repo, prNumber, ['blocked', 'needs-nishad']);
  } catch (err) {
    log.warn({ err, repo, prNumber }, 'Failed to apply timeout labels (continuing)');
  }

  // Update PR mapping status if present.
  await db
    .update(schema.githubPrMappings)
    .set({ status: 'blocked', updatedAt: new Date() })
    .where(
      and(
        eq(schema.githubPrMappings.repo, repo),
        eq(schema.githubPrMappings.prNumber, prNumber),
      ),
    );

  // Audit log entry: a policy_violations row captures this as a soft failure.
  await db.insert(schema.policyViolations).values({
    repo,
    prNumber,
    violationType: 'limit_exceeded',
    reason: 'QA review timeout — no ChatGPT review received within window',
    payloadJson: { scheduledAt: args.scheduledAt, observedAt: new Date().toISOString() },
  });

  return { action: 'flagged' };
}
