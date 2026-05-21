import { getDb, schema } from '@claudegpt/db';
import { getLogger } from '@claudegpt/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ClickUpApiError, createComment, updateTaskStatus } from './client.js';
import { resolveStatus } from './statusMap.js';

const log = getLogger('clickup.sync');

/**
 * Payload shape this sync agent accepts. Matches docs/07-worker-jobs.md §6.4
 * plus the `trigger_event` field documented in agents/sync.md. Everything is
 * optional except the trigger — we resolve the task id via `clickup_mappings`
 * when not provided directly.
 */
const syncPayloadSchema = z.object({
  github_repo: z.string().min(1),
  github_issue_number: z.number().int().positive().optional(),
  github_pr_number: z.number().int().positive().optional(),
  clickup_task_id: z.string().min(1).optional(),
  new_status: z.string().min(1).optional(),
  comment: z.string().optional(),
  trigger_event: z.string().min(1).optional(),
});

export type SyncPayload = z.infer<typeof syncPayloadSchema>;

/**
 * Outcome surface for telemetry / tests. `runSync` always returns — it does
 * not throw for ClickUp 4xx (those are non-fatal per agents/sync.md
 * §"Failure handling"). 5xx and network errors are re-thrown so BullMQ retries.
 */
export interface SyncResult {
  jobId: string;
  outcome: 'synced' | 'skipped' | 'failed';
  reason?: string;
  taskId?: string;
  status?: string;
}

/**
 * Look up a ClickUp task id when the payload doesn't carry one. We use the
 * `clickup_mappings` table keyed by either (repo, issue#) or (repo, pr#). If
 * both are present, prefer the PR mapping because PR-driven events are the
 * more specific signal.
 */
async function resolveTaskId(
  db: ReturnType<typeof getDb>,
  payload: SyncPayload,
): Promise<{ taskId: string; mappingId: string } | null> {
  if (payload.github_pr_number !== undefined) {
    const rows = await db
      .select({ id: schema.clickupMappings.id, taskId: schema.clickupMappings.clickupTaskId })
      .from(schema.clickupMappings)
      .where(
        and(
          eq(schema.clickupMappings.githubRepo, payload.github_repo),
          eq(schema.clickupMappings.githubPrNumber, payload.github_pr_number),
        ),
      )
      .limit(1);
    const hit = rows[0];
    if (hit) return { taskId: hit.taskId, mappingId: hit.id };
  }
  if (payload.github_issue_number !== undefined) {
    const rows = await db
      .select({ id: schema.clickupMappings.id, taskId: schema.clickupMappings.clickupTaskId })
      .from(schema.clickupMappings)
      .where(
        and(
          eq(schema.clickupMappings.githubRepo, payload.github_repo),
          eq(schema.clickupMappings.githubIssueNumber, payload.github_issue_number),
        ),
      )
      .limit(1);
    const hit = rows[0];
    if (hit) return { taskId: hit.taskId, mappingId: hit.id };
  }
  return null;
}

/**
 * Load project metadata so we can read `clickup_status_map` overrides. Returns
 * an empty object if the project has no metadata or the column shape isn't a
 * plain object — the default mapping is always a safe fallback.
 */
async function loadProjectMetadata(
  db: ReturnType<typeof getDb>,
  projectId: string,
): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ configJson: schema.projects.configJson })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const cfg = rows[0]?.configJson;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return {};
  const md = (cfg as Record<string, unknown>)['metadata'];
  if (!md || typeof md !== 'object' || Array.isArray(md)) return {};
  return md as Record<string, unknown>;
}

/**
 * Mark the agent_jobs row as finished. `completed_at` is always set; status
 * differentiates succeeded vs failed vs blocked for downstream dashboards.
 */
async function markJob(
  db: ReturnType<typeof getDb>,
  jobId: string,
  status: 'succeeded' | 'failed' | 'blocked',
): Promise<void> {
  await db
    .update(schema.agentJobs)
    .set({ status, completedAt: new Date() })
    .where(eq(schema.agentJobs.id, jobId));
}

/**
 * Record the run row for this sync attempt. We create the run lazily on first
 * call so multiple BullMQ retries each produce their own audit entry. The run
 * mirrors the job's final outcome.
 */
async function recordRun(
  db: ReturnType<typeof getDb>,
  jobId: string,
  status: 'succeeded' | 'failed',
  summary: string,
  errorMessage?: string,
): Promise<void> {
  const now = new Date();
  await db.insert(schema.agentRuns).values({
    jobId,
    status,
    resultSummary: summary,
    errorMessage: errorMessage ?? null,
    startedAt: now,
    completedAt: now,
  });
}

/**
 * Main entrypoint. The worker handler in apps/worker passes the agent_jobs row
 * id (NOT the BullMQ job id — they happen to coincide because enqueueJob sets
 * `{ jobId: agent_jobs.id }`, but only this id is meaningful to the DB).
 *
 * Contract:
 * - Throws ONLY for transient/5xx ClickUp errors and unexpected DB failures
 *   (so BullMQ re-queues per the 5-attempt exponential schedule in
 *   docs/07 §4). Everything else — missing mapping, unknown trigger, 4xx —
 *   is logged and the job is marked succeeded/failed/blocked terminally.
 */
export async function runSync(jobId: string): Promise<SyncResult> {
  const db = getDb();

  // 1. Load the agent_jobs row.
  const jobs = await db
    .select()
    .from(schema.agentJobs)
    .where(eq(schema.agentJobs.id, jobId))
    .limit(1);
  const job = jobs[0];
  if (!job) {
    log.error({ jobId }, 'Sync job row not found.');
    return { jobId, outcome: 'failed', reason: 'job_not_found' };
  }

  // Mark running early so dashboards reflect work-in-progress immediately.
  await db
    .update(schema.agentJobs)
    .set({ status: 'running', startedAt: job.startedAt ?? new Date() })
    .where(eq(schema.agentJobs.id, jobId));

  // 2. Validate payload.
  const parsed = syncPayloadSchema.safeParse(job.payloadJson);
  if (!parsed.success) {
    log.error({ jobId, issues: parsed.error.issues }, 'Sync payload failed validation.');
    await markJob(db, jobId, 'failed');
    await recordRun(db, jobId, 'failed', 'invalid payload', JSON.stringify(parsed.error.issues));
    return { jobId, outcome: 'failed', reason: 'invalid_payload' };
  }
  const payload = parsed.data;

  // 3. Resolve task id (payload first, mapping table second).
  let taskId = payload.clickup_task_id ?? job.clickupTaskId ?? undefined;
  let mappingId: string | undefined;
  if (!taskId) {
    const lookup = await resolveTaskId(db, payload);
    if (lookup) {
      taskId = lookup.taskId;
      mappingId = lookup.mappingId;
    }
  }

  if (!taskId) {
    // Best-effort sync: GitHub is source of truth. Not having a ClickUp task is
    // expected for projects that haven't onboarded ClickUp yet.
    log.warn(
      {
        jobId,
        repo: payload.github_repo,
        issue: payload.github_issue_number,
        pr: payload.github_pr_number,
      },
      'No ClickUp task linked; skipping sync.',
    );
    await markJob(db, jobId, 'succeeded');
    await recordRun(db, jobId, 'succeeded', 'no clickup task linked; skipped');
    return { jobId, outcome: 'skipped', reason: 'no_task_mapping' };
  }

  // 4. Resolve target status.
  let targetStatus: string | null = payload.new_status ?? null;
  if (!targetStatus && payload.trigger_event) {
    const metadata = await loadProjectMetadata(db, job.projectId);
    targetStatus = resolveStatus(payload.trigger_event, metadata);
  }

  // 5. Apply mutations. Each ClickUp call is wrapped so 4xx is contained.
  const commentBody = payload.comment;
  try {
    if (targetStatus) {
      await updateTaskStatus(taskId, targetStatus);
      log.info({ jobId, taskId, status: targetStatus }, 'ClickUp task status updated.');
    } else {
      log.info(
        { jobId, taskId, trigger: payload.trigger_event },
        'No target status resolved; comment-only sync.',
      );
    }

    if (commentBody && commentBody.length > 0) {
      await createComment(taskId, commentBody);
      log.info({ jobId, taskId }, 'ClickUp comment posted.');
    }
  } catch (err) {
    if (err instanceof ClickUpApiError && !err.retriable) {
      // 4xx: bad request, permission denied, status name doesn't exist. Log
      // and mark the job failed but DO NOT throw — sync drift is non-fatal,
      // and retrying won't help. See agents/sync.md §"Failure handling".
      log.error(
        { jobId, taskId, status: err.status, body: err.body.slice(0, 500) },
        'ClickUp 4xx during sync; marking job failed (non-retriable).',
      );
      await markJob(db, jobId, 'failed');
      await recordRun(
        db,
        jobId,
        'failed',
        `ClickUp ${err.status}`,
        err.body.slice(0, 1000),
      );
      return { jobId, outcome: 'failed', reason: `clickup_${err.status}`, taskId };
    }
    // Retriable — let BullMQ exponential-backoff this for us. We still update
    // the run row so the audit trail captures the attempt.
    log.warn({ jobId, taskId, err }, 'ClickUp sync attempt errored; rethrowing for retry.');
    await recordRun(
      db,
      jobId,
      'failed',
      'transient error; will retry',
      err instanceof Error ? err.message : String(err),
    );
    // Do NOT mark job failed here — BullMQ will re-run it. Reset to queued so
    // the dashboard reflects the pending retry.
    await db
      .update(schema.agentJobs)
      .set({ status: 'queued' })
      .where(eq(schema.agentJobs.id, jobId));
    throw err;
  }

  // 6. Sync mapping row status so downstream views stay accurate. We map the
  //    target ClickUp status name back to one of our internal mapping_status
  //    enum values where possible; otherwise leave the mapping alone.
  if (mappingId || taskId) {
    const mappingStatus = inferMappingStatus(payload.trigger_event, targetStatus);
    if (mappingStatus) {
      await db
        .update(schema.clickupMappings)
        .set({ status: mappingStatus, updatedAt: new Date() })
        .where(eq(schema.clickupMappings.clickupTaskId, taskId));
    }
  }

  // 7. Mark job succeeded.
  await markJob(db, jobId, 'succeeded');
  await recordRun(
    db,
    jobId,
    'succeeded',
    targetStatus ? `synced to "${targetStatus}"` : 'comment posted',
  );

  return {
    jobId,
    outcome: 'synced',
    taskId,
    status: targetStatus ?? undefined,
  };
}

/**
 * Best-effort projection from (triggerEvent | clickupStatus) onto our internal
 * `mapping_status` enum. Used to keep clickup_mappings.status meaningful for
 * the dashboard query layer. Returns null when we cannot confidently classify.
 */
function inferMappingStatus(
  triggerEvent: string | undefined,
  targetStatus: string | null,
):
  | 'open'
  | 'in_progress'
  | 'qa'
  | 'rework'
  | 'approved'
  | 'merged'
  | 'closed'
  | 'blocked'
  | null {
  if (triggerEvent) {
    if (triggerEvent === 'issue.labeled.claude-ready') return 'open';
    if (triggerEvent === 'issue.labeled.claude-claimed') return 'in_progress';
    if (triggerEvent === 'pull_request.opened') return 'qa';
    if (triggerEvent === 'pull_request.labeled.openai-qa') return 'qa';
    if (triggerEvent === 'pull_request.labeled.openai-approved') return 'approved';
    if (triggerEvent === 'pull_request.labeled.claude-rework') return 'rework';
    if (triggerEvent === 'issue.labeled.blocked') return 'blocked';
    if (triggerEvent === 'issue.labeled.needs-nishad') return 'blocked';
    if (triggerEvent === 'pull_request.closed.merged') return 'merged';
    if (triggerEvent === 'pull_request.closed') return 'closed';
  }
  // Fallback by ClickUp status name (handles override maps).
  if (targetStatus) {
    const s = targetStatus.toLowerCase();
    if (s.includes('blocked')) return 'blocked';
    if (s.includes('rework')) return 'rework';
    if (s.includes('qa') || s.includes('review')) return 'qa';
    if (s.includes('released') || s.includes('merged')) return 'merged';
    if (s.includes('complete') || s.includes('approved')) return 'approved';
  }
  return null;
}
