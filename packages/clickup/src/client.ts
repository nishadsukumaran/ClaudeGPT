import { request } from 'undici';
import { loadEnv, getLogger } from '@claudegpt/shared';

const log = getLogger('clickup.client');

/**
 * ClickUp v2 base URL. Per https://clickup.com/api the platform is hosted at
 * api.clickup.com and the v2 surface is rooted at `/api/v2/...`.
 */
const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';

/**
 * Number of times we'll re-issue a request on 429 (rate limit) before giving up.
 * BullMQ does an outer retry layer (5 attempts per docs/07 §4); this inner retry
 * is just for "polite" cooperation with the `Retry-After` header so a single job
 * attempt does not waste a BullMQ slot on a known short pause.
 */
const RATE_LIMIT_RETRY_MAX = 3;

/**
 * Wall-clock cap per ClickUp request. Sync agent has a 2-minute budget for the
 * entire job (agents/sync.md). Individual HTTP calls should fail fast — 20s is
 * generous and still leaves headroom for the retry loop plus the comment call.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Typed errors so callers (sync.ts) can decide whether to swallow or rethrow.
 *
 * - 4xx => permanent (bad task id, bad status name, perms). Should NOT retry.
 * - 5xx => transient. Should retry (we rethrow so BullMQ picks it up).
 * - 429 => rate limited. We auto-back-off inside the client; if exhausted, retry.
 */
export class ClickUpApiError extends Error {
  public readonly status: number;
  public readonly body: string;
  public readonly retriable: boolean;

  constructor(status: number, body: string, message?: string) {
    super(message ?? `ClickUp API error ${status}: ${body.slice(0, 200)}`);
    this.name = 'ClickUpApiError';
    this.status = status;
    this.body = body;
    // 4xx (except 429) are client errors — not retriable.
    // 429 is handled inside the client, but if we surface it here the outer
    // queue retry will kick in, which is also fine.
    this.retriable = status === 429 || status >= 500;
  }
}

let cachedApiKey: string | null = null;

function getApiKey(): string {
  if (cachedApiKey) return cachedApiKey;
  const env = loadEnv();
  if (!env.CLICKUP_API_KEY) {
    throw new Error('CLICKUP_API_KEY is not set; ClickUp sync cannot run.');
  }
  cachedApiKey = env.CLICKUP_API_KEY;
  return cachedApiKey;
}

/** For tests: clear the cached API key. */
export function resetClickUpClient(): void {
  cachedApiKey = null;
}

/**
 * Sleep helper. We use it for Retry-After backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse `Retry-After` per RFC 7231. ClickUp returns either a number of seconds
 * (most common) or an HTTP-date. We support both; if missing or unparseable we
 * fall back to a small fixed delay.
 */
function parseRetryAfter(header: string | string[] | undefined): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return 2_000;
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(asSeconds * 1000, 60_000);
  }
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.max(0, Math.min(asDate - Date.now(), 60_000));
  }
  return 2_000;
}

interface RawResponse {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

async function rawRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  bodyJson?: unknown,
): Promise<RawResponse> {
  const url = `${CLICKUP_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    // ClickUp v2 expects the raw API key as the Authorization header — NO
    // `Bearer ` prefix. Confirmed against https://clickup.com/api/.
    authorization: getApiKey(),
    accept: 'application/json',
  };
  if (bodyJson !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await request(url, {
    method,
    headers,
    body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
    bodyTimeout: REQUEST_TIMEOUT_MS,
    headersTimeout: REQUEST_TIMEOUT_MS,
  });
  const text = await res.body.text();
  return { status: res.statusCode, body: text, headers: res.headers };
}

/**
 * Issue a request with Retry-After-aware 429 handling. 4xx/5xx that escape the
 * 429 loop are converted into a typed ClickUpApiError; the caller decides what
 * to do with it.
 */
async function clickupRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  bodyJson?: unknown,
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await rawRequest(method, path, bodyJson);

    if (res.status >= 200 && res.status < 300) {
      if (!res.body) return {} as T;
      try {
        return JSON.parse(res.body) as T;
      } catch {
        // Some endpoints (e.g. PUT task) return an empty 200. Tolerate that.
        return {} as T;
      }
    }

    if (res.status === 429 && attempt < RATE_LIMIT_RETRY_MAX) {
      const wait = parseRetryAfter(res.headers['retry-after']);
      log.warn({ path, attempt, waitMs: wait }, 'ClickUp 429 received; backing off.');
      attempt += 1;
      await sleep(wait);
      continue;
    }

    throw new ClickUpApiError(res.status, res.body);
  }
}

/* ---------- Public API ---------- */

export interface ClickUpTask {
  id: string;
  name: string;
  status?: { status: string; type?: string };
  list?: { id: string };
  url?: string;
  [k: string]: unknown;
}

export interface ClickUpComment {
  id: string;
  comment_text?: string;
}

/**
 * GET /api/v2/task/{taskId}
 *
 * Returns the full task object. Used to read the current `status` before we
 * update so we can no-op when already there and skip a redundant comment.
 */
export async function getTask(taskId: string): Promise<ClickUpTask> {
  return clickupRequest<ClickUpTask>('GET', `/task/${encodeURIComponent(taskId)}`);
}

/**
 * PUT /api/v2/task/{taskId}
 *
 * ClickUp's "Update Task" endpoint accepts the human-readable status NAME in
 * the `status` field — not a status ID. The name is case-insensitive but must
 * match a status that exists on the task's current list. If the list doesn't
 * have that status, ClickUp returns 400.
 *
 * That is the only mutation we need for status changes; ClickUp resolves the
 * name -> internal status id server-side.
 */
export async function updateTaskStatus(taskId: string, status: string): Promise<ClickUpTask> {
  return clickupRequest<ClickUpTask>('PUT', `/task/${encodeURIComponent(taskId)}`, { status });
}

/**
 * POST /api/v2/task/{taskId}/comment
 *
 * Appends a comment. We always post as the API-key owner. ClickUp requires
 * `comment_text` (the displayed text); `notify_all` is false so we don't spam
 * watchers with every sync event.
 */
export async function createComment(taskId: string, body: string): Promise<ClickUpComment> {
  return clickupRequest<ClickUpComment>(
    'POST',
    `/task/${encodeURIComponent(taskId)}/comment`,
    { comment_text: body, notify_all: false },
  );
}

/**
 * Move a task to a different list. ClickUp's documented move endpoint is
 *   POST /api/v2/list/{listId}/task/{taskId}
 * (see https://clickup.com/api/clickupreference/operation/AddTaskToList/).
 *
 * We expose this for completeness — the sync agent generally relies on
 * `updateTaskStatus` because the project's ClickUp folder is structured so
 * that statuses are list-scoped already. Moving lists is reserved for the
 * future "release" flow.
 */
export async function moveTask(taskId: string, listId: string): Promise<void> {
  await clickupRequest<unknown>(
    'POST',
    `/list/${encodeURIComponent(listId)}/task/${encodeURIComponent(taskId)}`,
  );
}

/**
 * Create a new ClickUp task inside a given list. Returns the created task —
 * we mostly care about the `id` so we can persist it in `clickup_mappings`
 * and update status later via `updateTaskStatus`.
 *
 * Reference: POST https://api.clickup.com/api/v2/list/{list_id}/task
 */
export async function createTask(args: {
  listId: string;
  name: string;
  description?: string;
  priority?: 1 | 2 | 3 | 4; // 1=urgent, 4=low (ClickUp convention)
  tags?: string[];
  assignees?: number[];
}): Promise<ClickUpTask> {
  const body: Record<string, unknown> = { name: args.name };
  if (args.description) body.description = args.description;
  if (args.priority) body.priority = args.priority;
  if (args.tags) body.tags = args.tags;
  if (args.assignees) body.assignees = args.assignees;
  return clickupRequest<ClickUpTask>(
    'POST',
    `/list/${encodeURIComponent(args.listId)}/task`,
    body,
  );
}
