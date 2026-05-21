/**
 * Process an inbound ChatGPT review event.
 *
 * The webhook router calls this when it sees a comment or PR-review from the
 * ChatGPT GitHub App bot account on a PR we're tracking. We parse the prose
 * via Claude, apply the verdict (labels + comment), update the PR mapping,
 * and enqueue a clickup_sync follow-up.
 */

import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '@claudegpt/db';
import { getLogger } from '@claudegpt/shared';
import { QUEUE_NAMES } from '@claudegpt/queue';
import { parseChatGptReview } from './claudeParser.js';
import { applyVerdict } from './applyVerdict.js';
import type { QaVerdict } from './parseResponse.js';

const log = getLogger('qa.inbound');

export interface ProcessInboundReviewArgs {
  /** agent_jobs.id of the queued openai_qa_review row */
  jobId: string;
}

export interface InboundReviewResult {
  runId: string;
  verdict: QaVerdict;
}

async function writeLog(
  runId: string,
  source: string,
  message: string,
  level: 'debug' | 'info' | 'warn' | 'error' = 'info',
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await getDb()
    .insert(schema.runLogs)
    .values({ runId, source, level, message, metadataJson: metadata });
}

/**
 * Public entrypoint. Expects payload_json on the agent_jobs row to contain:
 *   {
 *     pr: { number, head_branch },
 *     review: { body: string, source: 'comment' | 'review', sender: 'chatgpt[bot]', ... }
 *   }
 */
export async function processInboundReview(args: ProcessInboundReviewArgs): Promise<InboundReviewResult> {
  const { jobId } = args;
  const db = getDb();

  const [job] = await db.select().from(schema.agentJobs).where(eq(schema.agentJobs.id, jobId));
  if (!job) throw new Error(`agent_jobs row ${jobId} not found`);
  if (job.jobType !== 'openai_qa_review') {
    throw new Error(`agent_jobs ${jobId} has jobType=${job.jobType}, expected openai_qa_review`);
  }

  const payload = (job.payloadJson ?? {}) as {
    pr?: { number?: number };
    review?: { body?: string; source?: string; sender?: string };
  };

  const reviewBody = payload.review?.body ?? '';
  const prNumber = job.githubPrNumber ?? payload.pr?.number;
  const repo = job.githubRepo;

  if (!prNumber) throw new Error(`agent_jobs ${jobId} has no PR number`);
  if (!reviewBody) throw new Error(`agent_jobs ${jobId} has no review body in payload`);

  await db
    .update(schema.agentJobs)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.agentJobs.id, jobId));

  const [run] = await db
    .insert(schema.agentRuns)
    .values({
      jobId: job.id,
      status: 'running',
      prNumber,
      startedAt: new Date(),
    })
    .returning({ id: schema.agentRuns.id });
  if (!run) throw new Error('Failed to create agent_runs row');
  const runId = run.id;

  log.info({ runId, jobId, repo, prNumber, source: payload.review?.source }, 'Processing inbound ChatGPT review');

  try {
    await writeLog(runId, 'qa.inbound.received', `Received ChatGPT review (${reviewBody.length} bytes) from ${payload.review?.sender}`);

    await writeLog(runId, 'qa.parse.claude', 'Invoking Claude to parse prose review');
    const verdict = await parseChatGptReview(reviewBody);
    await writeLog(runId, 'qa.parse.claude', `Verdict: ${verdict.result}`, 'info', {
      criticalCount: verdict.critical_issues.length,
      scopeViolations: verdict.scope_violations.length,
    });

    await writeLog(runId, 'qa.comment', `Posting verdict (result=${verdict.result})`);
    await applyVerdict(repo, prNumber, verdict);
    await writeLog(runId, 'qa.labels', 'Labels applied');

    const newMappingStatus = verdict.result === 'pass' ? 'approved' : 'rework';
    await db
      .update(schema.githubPrMappings)
      .set({ status: newMappingStatus, latestQaRunId: runId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.githubPrMappings.repo, repo),
          eq(schema.githubPrMappings.prNumber, prNumber),
        ),
      );

    await db
      .update(schema.agentRuns)
      .set({
        status: 'succeeded',
        resultSummary: verdict.summary,
        completedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, runId));

    await db
      .update(schema.agentJobs)
      .set({ status: 'succeeded', completedAt: new Date() })
      .where(eq(schema.agentJobs.id, jobId));

    // Follow-up clickup_sync (DB row only; routing layer publishes to BullMQ).
    try {
      await db.insert(schema.agentJobs).values({
        projectId: job.projectId,
        agentId: job.agentId,
        jobType: 'clickup_sync',
        status: 'queued',
        priority: 100,
        githubRepo: repo,
        githubIssueNumber: job.githubIssueNumber ?? null,
        githubPrNumber: prNumber,
        clickupTaskId: job.clickupTaskId ?? null,
        payloadJson: {
          source: QUEUE_NAMES.openaiQa,
          qa_run_id: runId,
          verdict: verdict.result,
          new_status: newMappingStatus,
          summary: verdict.summary,
        },
      });
      await writeLog(runId, 'qa.followup', 'clickup_sync job row enqueued');
    } catch (err) {
      log.warn({ err, runId }, 'Follow-up clickup_sync enqueue failed (non-fatal)');
      await writeLog(runId, 'qa.followup', 'Follow-up enqueue failed (non-fatal)', 'warn');
    }

    log.info({ runId, jobId, repo, prNumber, verdict: verdict.result }, 'Inbound review processed');
    return { runId, verdict };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ runId, jobId, err }, 'Inbound review processing failed');
    await db
      .update(schema.agentRuns)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId));
    await db
      .update(schema.agentJobs)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(schema.agentJobs.id, jobId));
    throw err;
  }
}
