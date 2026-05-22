/**
 * High-level lifecycle helpers — wire GitHub events to ClickUp tasks in the
 * "AI Delivery Desk" space.
 *
 * The contract is best-effort: if any env-var/list-id is missing or the API
 * call fails, we LOG and return null rather than throwing. The orchestrator's
 * core loop must never break because ClickUp is misconfigured.
 */

import { getDb, schema } from '@claudegpt/db';
import { getLogger, loadEnv } from '@claudegpt/shared';
import { and, eq } from 'drizzle-orm';
import { createTask, updateTaskStatus, createComment, moveTask, ClickUpApiError } from './client.js';

const log = getLogger('clickup.lifecycle');

/**
 * Map a lane name to the env-var that holds its list id. Keep this in sync
 * with the ClickUp setup in Railway env config.
 */
const LANE_ENV: Record<string, keyof NodeJS.ProcessEnv> = {
  ready_for_build: 'CLICKUP_LIST_READY_FOR_BUILD',
  in_build: 'CLICKUP_LIST_IN_BUILD',
  qa_review: 'CLICKUP_LIST_QA_REVIEW',
  build_complete: 'CLICKUP_LIST_BUILD_COMPLETE',
  ready_for_release: 'CLICKUP_LIST_READY_FOR_RELEASE',
  bugs: 'CLICKUP_LIST_BUGS',
  nishad_actions: 'CLICKUP_LIST_NISHAD_ACTIONS',
  creds_needed: 'CLICKUP_LIST_CREDS_NEEDED',
  claude_logs: 'CLICKUP_LIST_CLAUDE_LOGS',
  chatgpt_logs: 'CLICKUP_LIST_CHATGPT_LOGS',
  system_logs: 'CLICKUP_LIST_SYSTEM_LOGS',
};

export type Lane = keyof typeof LANE_ENV;

function getListId(lane: Lane): string | null {
  const key = LANE_ENV[lane];
  const value = key ? process.env[key] : undefined;
  return value && value.trim() ? value : null;
}

/**
 * Find an existing mapping for a (repo, issue_number) pair. Returns the
 * ClickUp task id, or null if none exists.
 */
async function findMapping(repo: string, issueNumber: number): Promise<string | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({ taskId: schema.clickupMappings.clickupTaskId })
      .from(schema.clickupMappings)
      .where(
        and(
          eq(schema.clickupMappings.githubRepo, repo),
          eq(schema.clickupMappings.githubIssueNumber, issueNumber),
        ),
      )
      .limit(1);
    return rows[0]?.taskId ?? null;
  } catch (err) {
    log.warn({ err }, 'findMapping failed');
    return null;
  }
}

async function resolveProjectId(repo: string): Promise<string | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.githubRepo, repo))
      .limit(1);
    return rows[0]?.id ?? null;
  } catch (err) {
    log.warn({ err }, 'resolveProjectId failed');
    return null;
  }
}

async function persistMapping(args: {
  repo: string;
  issueNumber?: number;
  prNumber?: number;
  clickupTaskId: string;
}): Promise<void> {
  try {
    const projectId = await resolveProjectId(args.repo);
    if (!projectId) {
      log.warn({ repo: args.repo }, 'persistMapping: no project for repo; skipping');
      return;
    }
    const db = getDb();
    await db.insert(schema.clickupMappings).values({
      projectId,
      githubRepo: args.repo,
      githubIssueNumber: args.issueNumber ?? null,
      githubPrNumber: args.prNumber ?? null,
      clickupTaskId: args.clickupTaskId,
    });
  } catch (err) {
    log.warn({ err }, 'persistMapping failed (mapping may already exist)');
  }
}

/**
 * Idempotently create-or-fetch a ClickUp task for the given GitHub issue.
 * Caller passes the destination lane. If a mapping already exists, we just
 * return the existing task id (no-op).
 *
 * Returns the ClickUp task id, or null if ClickUp is not configured / failed.
 */
export async function ensureTaskForIssue(args: {
  repo: string;
  issueNumber: number;
  title: string;
  bodyMarkdown?: string;
  lane: Lane;
}): Promise<string | null> {
  const env = loadEnv();
  if (!env.CLICKUP_API_KEY) {
    log.debug('ClickUp not configured; skipping ensureTaskForIssue');
    return null;
  }
  const existing = await findMapping(args.repo, args.issueNumber);
  if (existing) return existing;

  const listId = getListId(args.lane);
  if (!listId) {
    log.warn({ lane: args.lane }, 'lane list-id env var not set; skipping');
    return null;
  }

  try {
    const task = await createTask({
      listId,
      name: `[${args.repo}#${args.issueNumber}] ${args.title}`.slice(0, 250),
      description:
        `${args.bodyMarkdown ?? ''}\n\n---\nGitHub: https://github.com/${args.repo}/issues/${args.issueNumber}`,
    });
    await persistMapping({
      repo: args.repo,
      issueNumber: args.issueNumber,
      clickupTaskId: task.id,
    });
    log.info({ repo: args.repo, issueNumber: args.issueNumber, taskId: task.id, lane: args.lane }, 'ClickUp task created');
    return task.id;
  } catch (err) {
    if (err instanceof ClickUpApiError) {
      log.warn({ status: err.status, body: err.body.slice(0, 200) }, 'ClickUp createTask failed');
    } else {
      log.warn({ err }, 'ClickUp createTask failed (non-fatal)');
    }
    return null;
  }
}

/**
 * Move an existing ClickUp task to a different lane (= different list).
 * If no mapping exists, this is a no-op. Returns true if moved.
 */
export async function moveTaskForIssue(args: {
  repo: string;
  issueNumber: number;
  lane: Lane;
  commentMarkdown?: string;
}): Promise<boolean> {
  const env = loadEnv();
  if (!env.CLICKUP_API_KEY) return false;
  const taskId = await findMapping(args.repo, args.issueNumber);
  if (!taskId) return false;
  const listId = getListId(args.lane);
  if (!listId) return false;
  try {
    await moveTask(taskId, listId);
    if (args.commentMarkdown) {
      await createComment(taskId, args.commentMarkdown).catch(() => {});
    }
    log.info({ repo: args.repo, issueNumber: args.issueNumber, lane: args.lane, taskId }, 'ClickUp task moved');
    return true;
  } catch (err) {
    log.warn({ err }, 'ClickUp moveTask failed (non-fatal)');
    return false;
  }
}

/**
 * Create an URGENT "Nishad Actions" ticket for human-in-the-loop blockers.
 * Used by runner.handleBlock and similar paths when the orchestrator can't
 * proceed without an action from a person.
 */
export async function createNishadActionTicket(args: {
  title: string;
  contextMarkdown: string;
  lane?: Lane;
}): Promise<string | null> {
  const env = loadEnv();
  if (!env.CLICKUP_API_KEY) return null;
  const lane: Lane = args.lane ?? 'nishad_actions';
  const listId = getListId(lane);
  if (!listId) {
    log.warn({ lane }, 'lane list-id env var not set');
    return null;
  }
  try {
    const task = await createTask({
      listId,
      name: args.title.slice(0, 250),
      description: args.contextMarkdown,
      priority: 1,
    });
    log.info({ taskId: task.id, lane }, 'Nishad-action ticket created');
    return task.id;
  } catch (err) {
    log.warn({ err }, 'createNishadActionTicket failed');
    return null;
  }
}

/**
 * Post a comment on the ClickUp task mapped to a GitHub issue. Best-effort.
 */
export async function commentOnIssueTask(args: {
  repo: string;
  issueNumber: number;
  body: string;
}): Promise<boolean> {
  const env = loadEnv();
  if (!env.CLICKUP_API_KEY) return false;
  const taskId = await findMapping(args.repo, args.issueNumber);
  if (!taskId) return false;
  try {
    await createComment(taskId, args.body);
    return true;
  } catch (err) {
    log.warn({ err }, 'commentOnIssueTask failed');
    return false;
  }
}


/**
 * Move a ClickUp task to a lane, finding the mapping by PR number (rather than
 * issue number). The QA listener has only the PR number — this helper looks up
 * the original issue via the existing clickup_mappings or github_pr_mappings.
 */
export async function moveTaskByPrNumber(args: {
  repo: string;
  prNumber: number;
  lane: Lane;
  commentMarkdown?: string;
}): Promise<boolean> {
  const env = loadEnv();
  if (!env.CLICKUP_API_KEY) return false;
  let taskId: string | null = null;
  try {
    const db = getDb();
    // 1. Direct lookup: did we store the PR -> task mapping?
    const directRows = await db
      .select({ taskId: schema.clickupMappings.clickupTaskId })
      .from(schema.clickupMappings)
      .where(
        and(
          eq(schema.clickupMappings.githubRepo, args.repo),
          eq(schema.clickupMappings.githubPrNumber, args.prNumber),
        ),
      )
      .limit(1);
    if (directRows[0]) taskId = directRows[0].taskId;
    // 2. Indirect lookup: via github_pr_mappings → issue#.
    if (!taskId) {
      const prMap = await db
        .select({ issueNumber: schema.githubPrMappings.issueNumber })
        .from(schema.githubPrMappings)
        .where(
          and(
            eq(schema.githubPrMappings.repo, args.repo),
            eq(schema.githubPrMappings.prNumber, args.prNumber),
          ),
        )
        .limit(1);
      const issueNumber = prMap[0]?.issueNumber;
      if (issueNumber) {
        taskId = await findMapping(args.repo, issueNumber);
      }
    }
  } catch (err) {
    log.warn({ err }, 'moveTaskByPrNumber: mapping lookup failed');
  }
  if (!taskId) return false;
  const listId = getListId(args.lane);
  if (!listId) return false;
  try {
    await moveTask(taskId, listId);
    if (args.commentMarkdown) {
      await createComment(taskId, args.commentMarkdown).catch(() => {});
    }
    log.info({ repo: args.repo, prNumber: args.prNumber, lane: args.lane, taskId }, 'ClickUp task moved (by PR)');
    return true;
  } catch (err) {
    log.warn({ err }, 'moveTaskByPrNumber failed');
    return false;
  }
}