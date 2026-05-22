import { getDb, schema } from '@claudegpt/db';
import { getRegistry, type ProjectConfig } from '@claudegpt/project-registry';
import { normalizeEvent, type NormalizedEvent } from '@claudegpt/github';
import { policyCheck, recordViolation, type PolicyDecision } from '@claudegpt/policy';
import { claimTask } from '@claudegpt/claim';
import { enqueueJob, QUEUE_NAMES, type QueueName } from '@claudegpt/queue';
import { ensureTaskForIssue, moveTaskForIssue } from '@claudegpt/clickup';
import { isChatGptBot } from '@claudegpt/qa';
import { getLogger } from '@claudegpt/shared';
import type { JobType } from '@claudegpt/shared';
import { eq } from 'drizzle-orm';

const log = getLogger('routing.router');

const QA_TIMEOUT_DELAY_MS = 30 * 60 * 1000; // 30 min before flagging missing ChatGPT review

export type RouteOutcome =
  | { status: 'enqueued'; jobId: string; jobType: JobType }
  | { status: 'scheduled'; jobId: string; jobType: JobType; delayMs: number }
  | { status: 'ignored'; reason: string }
  | { status: 'blocked'; reason: string; violationType: string }
  | { status: 'already_claimed'; existingJobId?: string }
  | { status: 'unknown_repo'; repo: string }
  | { status: 'not_found' };

interface Target {
  jobType: JobType;
  queue: QueueName;
  /** When set, the job is enqueued with this delay (BullMQ scheduled). */
  delayMs?: number;
  /** Payload mode hint for handlers that switch on payload.mode. */
  mode?: 'inbound' | 'timeout';
}

/**
 * Map (event, applied label) → routable target. Returns null when the event
 * isn't actionable. Listener-pattern QA: ChatGPT's GitHub App posts reviews
 * directly to the PR; we react to those, and we ALSO schedule a timeout watcher
 * on PR open in case the review never arrives.
 */
function resolveTarget(
  event: NormalizedEvent,
  appliedLabel: string,
  project: ProjectConfig,
): Target | null {
  // 1. issues.labeled → claude-ready → builder
  if (event.eventType === 'issues' && event.action === 'labeled' && appliedLabel === project.trustedTriggerLabel) {
    return { jobType: 'claude_implement_issue', queue: QUEUE_NAMES.claudeImplement };
  }

  // 2. pull_request.labeled → claude-rework → rework
  if (event.eventType === 'pull_request' && event.action === 'labeled' && appliedLabel === project.labels.rework) {
    return { jobType: 'claude_rework_pr', queue: QUEUE_NAMES.claudeRework };
  }

  // 3. pull_request.opened → schedule QA timeout watcher (delayed job).
  //    The actual QA verdict comes from the ChatGPT GitHub App listener, not from us.
  if (event.eventType === 'pull_request' && event.action === 'opened') {
    return {
      jobType: 'openai_qa_review',
      queue: QUEUE_NAMES.openaiQa,
      delayMs: QA_TIMEOUT_DELAY_MS,
      mode: 'timeout',
    };
  }

  // 4. issue_comment.created from ChatGPT bot on a PR → process inbound review.
  //    (GitHub posts PR comments as issue_comment events with .issue.pull_request present.)
  if (event.eventType === 'issue_comment' && event.action === 'created' && isChatGptBot(event.sender)) {
    return { jobType: 'openai_qa_review', queue: QUEUE_NAMES.openaiQa, mode: 'inbound' };
  }

  // 5. pull_request_review.submitted from ChatGPT bot → process inbound review.
  if (event.eventType === 'pull_request_review' && event.action === 'submitted' && isChatGptBot(event.sender)) {
    return { jobType: 'openai_qa_review', queue: QUEUE_NAMES.openaiQa, mode: 'inbound' };
  }

  return null;
}

async function getAgentIdByName(name: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.name, name))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) throw new Error(`Agent "${name}" not seeded; run seedAgents()`);
  return id;
}

async function getProjectIdByRepo(repo: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.githubRepo, repo))
    .limit(1);
  return rows[0]?.id ?? null;
}

function agentNameForJobType(jobType: JobType): string {
  switch (jobType) {
    case 'claude_implement_issue':
      return 'claude-builder';
    case 'claude_rework_pr':
      return 'claude-rework';
    case 'openai_qa_review':
      return 'openai-reviewer';
    case 'clickup_sync':
      return 'clickup-sync';
    case 'release_prep':
      return 'release-prep';
    default:
      return 'claude-builder';
  }
}

function buildBranchName(project: ProjectConfig, issueNumber: number, title: string): string {
  const slug = (title || `issue-${issueNumber}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${project.branchPrefix}/issue-${issueNumber}-${slug}`;
}

function buildImplementPayload(event: NormalizedEvent, project: ProjectConfig, decision: PolicyDecision) {
  const raw = event.raw as {
    issue?: { number?: number; title?: string; body?: string; html_url?: string };
  } | null;
  const issue = raw?.issue;
  const number = issue?.number ?? event.issueNumber ?? 0;
  const title = issue?.title ?? '';
  return {
    issue: {
      number,
      title,
      body: issue?.body ?? '',
      labels: event.labels,
      url: issue?.html_url ?? '',
    },
    trigger: {
      event_type: `${event.eventType}.${event.action ?? ''}`,
      user: event.sender,
      applied_label: decision.allow ? decision.appliedLabel : null,
      delivery_id: event.deliveryId,
    },
    branch_name: buildBranchName(project, number, title),
    policy_decision: decision.allow
      ? { approved: true, checks_passed: decision.checksPassed }
      : { approved: false, reason: decision.reason },
  };
}

function buildReworkPayload(event: NormalizedEvent, decision: PolicyDecision) {
  const raw = event.raw as {
    pull_request?: { number?: number; title?: string; head?: { ref?: string }; html_url?: string };
    issue?: { number?: number; title?: string; body?: string; html_url?: string };
  } | null;
  const pr = raw?.pull_request;
  return {
    pr: {
      number: pr?.number ?? event.prNumber ?? 0,
      title: pr?.title ?? '',
      head_branch: pr?.head?.ref ?? '',
      url: pr?.html_url ?? '',
    },
    issue: raw?.issue
      ? {
          number: raw.issue.number ?? 0,
          title: raw.issue.title ?? '',
          body: raw.issue.body ?? '',
          url: raw.issue.html_url ?? '',
        }
      : null,
    qa_feedback: null,
    trigger: {
      event_type: `${event.eventType}.${event.action ?? ''}`,
      user: event.sender,
      applied_label: decision.allow ? decision.appliedLabel : null,
      delivery_id: event.deliveryId,
    },
  };
}

function buildInboundReviewPayload(event: NormalizedEvent) {
  const raw = event.raw as {
    comment?: { body?: string; html_url?: string };
    review?: { body?: string; state?: string; html_url?: string };
    issue?: { number?: number; pull_request?: unknown; title?: string };
    pull_request?: { number?: number; title?: string; head?: { ref?: string } };
  } | null;

  // PR number can come from either pull_request_review event or issue_comment (where issue.pull_request is set).
  const prNumber =
    raw?.pull_request?.number ??
    raw?.issue?.number ??
    event.prNumber ??
    event.issueNumber ??
    0;

  // Body source depends on event type.
  const isReviewEvent = event.eventType === 'pull_request_review';
  const body = isReviewEvent ? raw?.review?.body ?? '' : raw?.comment?.body ?? '';
  const url = isReviewEvent ? raw?.review?.html_url ?? '' : raw?.comment?.html_url ?? '';

  return {
    mode: 'inbound' as const,
    pr: {
      number: prNumber,
      title: raw?.pull_request?.title ?? raw?.issue?.title ?? '',
      head_branch: raw?.pull_request?.head?.ref ?? '',
    },
    review: {
      source: isReviewEvent ? 'review' : 'comment',
      sender: event.sender ?? '',
      state: isReviewEvent ? raw?.review?.state ?? null : null,
      body,
      url,
    },
    trigger: {
      event_type: `${event.eventType}.${event.action ?? ''}`,
      delivery_id: event.deliveryId,
    },
  };
}

function buildTimeoutPayload(event: NormalizedEvent) {
  const raw = event.raw as {
    pull_request?: { number?: number; title?: string };
  } | null;
  return {
    mode: 'timeout' as const,
    pr: {
      number: raw?.pull_request?.number ?? event.prNumber ?? 0,
      title: raw?.pull_request?.title ?? '',
    },
    timeout: {
      scheduled_at: new Date().toISOString(),
      delay_ms: QA_TIMEOUT_DELAY_MS,
    },
    trigger: {
      event_type: `${event.eventType}.${event.action ?? ''}`,
      delivery_id: event.deliveryId,
    },
  };
}

async function markEventProcessed(eventId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.githubEvents)
    .set({ processedAt: new Date() })
    .where(eq(schema.githubEvents.id, eventId));
}

/**
 * Main entrypoint. Given an event id from `github_events`, run the full
 * routing pipeline: resolve project, run policy (for labeled triggers), build
 * payload, insert `agent_jobs` row, claim if issue-targeted, enqueue (optionally
 * delayed for timeout watchers). Always marks the event `processed_at`.
 */
export async function routeEvent(eventId: string): Promise<RouteOutcome> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.githubEvents)
    .where(eq(schema.githubEvents.id, eventId))
    .limit(1);
  const eventRow = rows[0];
  if (!eventRow) {
    log.warn({ eventId }, 'routeEvent: github_events row not found.');
    return { status: 'not_found' };
  }

  if (eventRow.processedAt) {
    log.info({ eventId }, 'Event already processed; skipping.');
    return { status: 'ignored', reason: 'already_processed' };
  }

  const event = normalizeEvent(
    {
      'x-github-event': eventRow.eventType,
      'x-github-delivery': eventRow.deliveryId,
    },
    eventRow.payloadJson as Record<string, unknown>,
  );

  const project = getRegistry().getByRepo(event.repo);
  if (!project) {
    await recordViolation({
      repo: event.repo,
      violationType: 'unknown_repo',
      reason: `Repository "${event.repo}" is not registered.`,
      payload: { delivery_id: event.deliveryId },
    });
    await markEventProcessed(eventId);
    return { status: 'unknown_repo', repo: event.repo };
  }

  // Policy gates only the labeled triggers (claude-ready, claude-rework). Inbound
  // ChatGPT events and PR-open timeouts bypass policy — they're observation events,
  // not authorization decisions.
  const isLabeledTrigger = event.action === 'labeled';
  let decision: PolicyDecision;
  if (isLabeledTrigger) {
    decision = policyCheck(event, project);
    if (!decision.allow) {
      await recordViolation({
        repo: event.repo,
        issueNumber: event.issueNumber,
        prNumber: event.prNumber,
        violationType: decision.violationType,
        reason: decision.reason,
        payload: decision.details ?? {},
      });
      await markEventProcessed(eventId);
      log.info(
        { eventId, repo: event.repo, reason: decision.reason, violationType: decision.violationType },
        'Policy blocked routing.',
      );
      return { status: 'blocked', reason: decision.reason, violationType: decision.violationType };
    }
  } else {
    // Synthesize a permissive decision for non-labeled events.
    decision = { allow: true, appliedLabel: '', checksPassed: ['observation_event'] };
  }

  const target = resolveTarget(event, decision.appliedLabel, project);
  if (!target) {
    log.info(
      {
        eventId,
        eventType: event.eventType,
        action: event.action,
        label: decision.appliedLabel,
        sender: event.sender,
      },
      'Event has no routable target; ignoring.',
    );
    await markEventProcessed(eventId);
    return { status: 'ignored', reason: 'no_target' };
  }

  // Inbound ChatGPT review must reference a PR we track. If we haven't seen the
  // PR (no github_pr_mappings row), this is a comment on an unrelated PR; drop it.
  if (target.mode === 'inbound') {
    const prNumber = event.prNumber ?? (event.raw as { issue?: { number?: number } })?.issue?.number ?? null;
    if (prNumber === null) {
      log.info({ eventId }, 'Inbound review event missing PR number; ignoring.');
      await markEventProcessed(eventId);
      return { status: 'ignored', reason: 'no_pr_number' };
    }
  }

  const projectId = await getProjectIdByRepo(event.repo);
  if (!projectId) {
    log.error(
      { eventId, repo: event.repo },
      'Project present in registry but missing in DB; cannot create agent_jobs row.',
    );
    await markEventProcessed(eventId);
    return { status: 'blocked', reason: 'project_row_missing', violationType: 'unknown_repo' };
  }

  const agentId = await getAgentIdByName(agentNameForJobType(target.jobType));

  let payload: Record<string, unknown>;
  if (target.jobType === 'claude_implement_issue') {
    payload = buildImplementPayload(event, project, decision) as unknown as Record<string, unknown>;
  } else if (target.jobType === 'claude_rework_pr') {
    payload = buildReworkPayload(event, decision) as unknown as Record<string, unknown>;
  } else if (target.mode === 'inbound') {
    payload = buildInboundReviewPayload(event) as unknown as Record<string, unknown>;
  } else if (target.mode === 'timeout') {
    payload = buildTimeoutPayload(event) as unknown as Record<string, unknown>;
  } else {
    // Should not reach — defensive default.
    payload = { trigger: { event_type: `${event.eventType}.${event.action ?? ''}`, delivery_id: event.deliveryId } };
  }

  const prNumberForJob =
    event.prNumber ??
    (event.raw as { issue?: { number?: number; pull_request?: unknown } })?.issue?.pull_request
      ? (event.raw as { issue?: { number?: number } }).issue?.number ?? null
      : null;

  const [jobRow] = await db
    .insert(schema.agentJobs)
    .values({
      projectId,
      agentId,
      jobType: target.jobType,
      status: 'queued',
      githubRepo: event.repo,
      githubIssueNumber: event.issueNumber,
      githubPrNumber: prNumberForJob,
      payloadJson: payload,
    })
    .returning({ id: schema.agentJobs.id });

  const jobId = jobRow?.id;
  if (!jobId) {
    log.error({ eventId }, 'agent_jobs insert returned no id.');
    return { status: 'blocked', reason: 'job_insert_failed', violationType: 'limit_exceeded' };
  }

  if (target.jobType === 'claude_implement_issue' && event.issueNumber !== null) {
    const claim = await claimTask(event.repo, event.issueNumber, jobId);
    if (!claim.claimed) {
      await db.delete(schema.agentJobs).where(eq(schema.agentJobs.id, jobId));
      await recordViolation({
        projectId,
        repo: event.repo,
        issueNumber: event.issueNumber,
        violationType: 'already_claimed',
        reason: `Issue #${event.issueNumber} already has an active claim.`,
        payload: { existing_job_id: claim.reason === 'already_claimed' ? claim.existingJobId : null },
      });
      await markEventProcessed(eventId);
      return {
        status: 'already_claimed',
        existingJobId: claim.reason === 'already_claimed' ? claim.existingJobId : undefined,
      };
    }
  }

  await enqueueJob(target.queue, jobId, target.delayMs ? { delay: target.delayMs } : undefined);
  await markEventProcessed(eventId);

  // Best-effort ClickUp sync. Failures here never break the orchestrator loop.
  try {
    if (target.jobType === 'claude_implement_issue' && event.issueNumber !== null) {
      const issue = (event.raw as { issue?: { title?: string; body?: string } })?.issue;
      await ensureTaskForIssue({
        repo: event.repo,
        issueNumber: event.issueNumber,
        title: issue?.title ?? `Issue #${event.issueNumber}`,
        bodyMarkdown: issue?.body ?? undefined,
        lane: 'ready_for_build',
      });
    } else if (target.jobType === 'openai_qa_review' && target.mode === 'timeout' && event.issueNumber !== null) {
      // PR opened — flip the existing build ticket to QA Review.
      await moveTaskForIssue({
        repo: event.repo,
        issueNumber: event.issueNumber,
        lane: 'qa_review',
        commentMarkdown: 'PR opened; awaiting Codex review.',
      });
    }
  } catch (err) {
    log.warn({ err }, 'ClickUp sync (routing) failed; ignoring');
  }

  if (target.delayMs) {
    log.info(
      { eventId, jobId, jobType: target.jobType, mode: target.mode, delayMs: target.delayMs, repo: event.repo, pr: event.prNumber },
      'Event routed and job scheduled.',
    );
    return { status: 'scheduled', jobId, jobType: target.jobType, delayMs: target.delayMs };
  }

  log.info(
    { eventId, jobId, jobType: target.jobType, mode: target.mode, repo: event.repo, issue: event.issueNumber, pr: event.prNumber },
    'Event routed and job enqueued.',
  );
  return { status: 'enqueued', jobId, jobType: target.jobType };
}
