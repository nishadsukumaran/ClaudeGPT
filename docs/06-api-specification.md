# API Specification

> HTTP contract for ClaudeGPT. The API is the only inbound surface: GitHub webhooks land here, internal dashboards read from here, future integrations call here. Everything is JSON over HTTPS.

Base URL: `https://orchestrator.{your-domain}` (configurable per environment).

## 1. Conventions

- **Format:** JSON request and response bodies. `Content-Type: application/json` required for writes.
- **Time:** All timestamps ISO 8601 with timezone (`2026-05-15T10:30:00Z`).
- **IDs:** All resource IDs are UUIDs unless the field name says otherwise (e.g., `github_issue_number` is an int).
- **Errors:** All errors follow the shape in section 9.
- **Versioning:** Path-prefixed `/v1/`. Breaking changes bump the prefix.
- **Auth:** Internal APIs require `Authorization: Bearer <token>`. Webhook endpoints validate provider-specific signatures instead.

## 2. Endpoint Map

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/health` | Liveness check | none |
| GET | `/v1/ready` | Readiness check (DB + queue) | none |
| POST | `/v1/webhooks/github` | GitHub webhook receiver | GitHub HMAC |
| POST | `/v1/webhooks/clickup` | ClickUp webhook receiver | ClickUp secret |
| GET | `/v1/projects` | List projects | bearer |
| GET | `/v1/projects/:slug` | Get one project | bearer |
| GET | `/v1/jobs` | List jobs (filtered) | bearer |
| GET | `/v1/jobs/:jobId` | Get one job | bearer |
| POST | `/v1/jobs/:jobId/cancel` | Cancel a queued/running job | bearer |
| GET | `/v1/runs/:runId` | Get one run with logs | bearer |
| GET | `/v1/runs/:runId/logs` | Stream/tail logs for a run | bearer |
| GET | `/v1/policy/violations` | List recent policy violations | bearer |
| GET | `/v1/stats/overview` | Aggregate metrics | bearer |

## 3. Health and Readiness

### `GET /health`

Always returns 200 if the process is alive. No DB checks.

```json
{ "status": "ok", "version": "0.1.0", "uptime_seconds": 1234 }
```

### `GET /v1/ready`

Returns 200 only when the DB, Redis queue, and required external creds resolve.

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "queue": "ok",
    "github_app": "ok",
    "openai": "ok",
    "anthropic": "ok",
    "clickup": "ok"
  }
}
```

Failure response: 503 with the same shape, failing component marked `error` and a `message` field.

## 4. Webhooks

### `POST /v1/webhooks/github`

GitHub sends events here. Orchestrator verifies, normalizes, and queues.

**Required headers:**

- `X-GitHub-Event` - event type (`issues`, `pull_request`, etc.)
- `X-GitHub-Delivery` - unique delivery ID (used for dedup)
- `X-Hub-Signature-256` - HMAC of body using webhook secret

**Validation:**

1. Reject if `X-Hub-Signature-256` invalid - 401.
2. Reject if `X-GitHub-Delivery` already in `github_events` table - 200 with `{ "deduped": true }`.
3. Reject if repo not in `projects` table - 200 with `{ "ignored": "unknown_repo" }` (don't 4xx because GitHub will retry).
4. Otherwise: insert event, enqueue routing job, return 202.

**Success response (202):**

```json
{ "accepted": true, "event_id": "uuid", "delivery_id": "..." }
```

### `POST /v1/webhooks/clickup`

(Reserved for future two-way sync. MVP returns 501.)

## 5. Projects

### `GET /v1/projects`

Query params: `?status=active|paused|archived` (optional).

```json
{
  "data": [
    {
      "id": "uuid",
      "slug": "ai-social-media-os",
      "name": "AI Social Media OS",
      "github_repo": "nishadsukumaran/ai-social-media-os",
      "default_branch": "main",
      "status": "active",
      "created_at": "2026-05-01T00:00:00Z"
    }
  ],
  "pagination": { "total": 1, "limit": 50, "offset": 0 }
}
```

### `GET /v1/projects/:slug`

Returns full config including `config_json`.

```json
{
  "id": "uuid",
  "slug": "ai-social-media-os",
  "name": "AI Social Media OS",
  "github_repo": "nishadsukumaran/ai-social-media-os",
  "clickup_folder_id": "901814081907",
  "default_branch": "main",
  "status": "active",
  "config_json": { /* see project config schema */ }
}
```

## 6. Jobs

### `GET /v1/jobs`

Query params:

- `project_slug` - filter by project
- `status` - `queued|running|succeeded|failed|blocked|cancelled` (comma-separated for multiple)
- `job_type` - filter by type
- `repo` - filter by GitHub repo
- `issue_number` - filter by issue
- `pr_number` - filter by PR
- `limit` - default 50, max 200
- `offset` - default 0

```json
{
  "data": [
    {
      "id": "uuid",
      "project": "ai-social-media-os",
      "agent": "claude-code",
      "job_type": "claude_implement_issue",
      "status": "running",
      "github_repo": "nishadsukumaran/ai-social-media-os",
      "github_issue_number": 12,
      "github_pr_number": null,
      "created_at": "2026-05-15T10:00:00Z",
      "started_at": "2026-05-15T10:00:05Z"
    }
  ],
  "pagination": { "total": 1, "limit": 50, "offset": 0 }
}
```

### `GET /v1/jobs/:jobId`

```json
{
  "id": "uuid",
  "project": { "slug": "ai-social-media-os", "name": "AI Social Media OS" },
  "agent": { "name": "claude-code", "provider": "anthropic" },
  "job_type": "claude_implement_issue",
  "status": "running",
  "github_repo": "nishadsukumaran/ai-social-media-os",
  "github_issue_number": 12,
  "github_pr_number": null,
  "clickup_task_id": "abc123",
  "payload_json": { /* trigger context */ },
  "created_at": "2026-05-15T10:00:00Z",
  "started_at": "2026-05-15T10:00:05Z",
  "completed_at": null,
  "runs": [
    { "id": "uuid", "status": "running", "started_at": "2026-05-15T10:00:05Z" }
  ]
}
```

### `POST /v1/jobs/:jobId/cancel`

Marks a queued or running job as `cancelled`. If running, sends kill signal to runner.

Request body: optional.

```json
{ "reason": "Owner cancelled - scope changed" }
```

Response (200):

```json
{ "id": "uuid", "status": "cancelled", "cancelled_at": "..." }
```

Errors:

- 404 - job not found
- 409 - job already in terminal state (`succeeded`, `failed`, `cancelled`)

## 7. Runs

### `GET /v1/runs/:runId`

```json
{
  "id": "uuid",
  "job_id": "uuid",
  "status": "running",
  "branch_name": "feature/issue-12-project-setup",
  "commit_sha": null,
  "pr_number": null,
  "prompt_snapshot": "... full prompt text ...",
  "result_summary": null,
  "error_message": null,
  "token_usage": 45000,
  "cost_usd": 0.42,
  "started_at": "2026-05-15T10:00:05Z",
  "completed_at": null
}
```

### `GET /v1/runs/:runId/logs`

Query params:

- `level` - `debug|info|warn|error` (default `info`)
- `since` - ISO timestamp, return logs after this
- `limit` - default 200, max 1000

```json
{
  "data": [
    {
      "id": "uuid",
      "run_id": "uuid",
      "level": "info",
      "source": "runner.git",
      "message": "Cloned repo, created branch feature/issue-12-project-setup",
      "metadata_json": { "duration_ms": 1240 },
      "created_at": "2026-05-15T10:00:06Z"
    }
  ]
}
```

Optional SSE mode for live tail: `Accept: text/event-stream` returns log events as they arrive.

## 8. Policy Violations

### `GET /v1/policy/violations`

Query params:

- `project_slug`
- `violation_type`
- `since`
- `limit`
- `offset`

```json
{
  "data": [
    {
      "id": "uuid",
      "project_slug": "ai-social-media-os",
      "repo": "nishadsukumaran/ai-social-media-os",
      "issue_number": 14,
      "violation_type": "missing_acceptance",
      "reason": "Issue body missing required 'Acceptance Criteria' section",
      "created_at": "2026-05-15T09:50:00Z"
    }
  ]
}
```

## 9. Stats Overview

### `GET /v1/stats/overview`

Query params:

- `period` - `24h|7d|30d` (default `7d`)
- `project_slug` - optional filter

```json
{
  "period": "7d",
  "jobs": { "queued": 2, "running": 1, "succeeded": 18, "failed": 3, "blocked": 1 },
  "runs": {
    "total": 25,
    "avg_duration_seconds": 412,
    "p95_duration_seconds": 890,
    "total_cost_usd": 12.45,
    "total_tokens": 1_234_567
  },
  "qa": { "passed": 14, "failed": 4, "pass_rate_pct": 77.8 },
  "policy_violations": { "total": 6, "by_type": { "missing_acceptance": 4, "untrusted_user": 2 } }
}
```

## 10. Error Format

All errors follow this shape:

```json
{
  "error": {
    "code": "invalid_signature",
    "message": "GitHub webhook signature did not verify.",
    "details": { "delivery_id": "abc-123" }
  },
  "request_id": "uuid"
}
```

Standard HTTP status codes:

- 200 - OK
- 202 - Accepted (async work queued)
- 400 - Bad request (validation failure)
- 401 - Unauthorized (bad/missing auth)
- 403 - Forbidden (auth fine, action not allowed)
- 404 - Not found
- 409 - Conflict (state machine prevents the action)
- 422 - Unprocessable (request valid but semantically wrong)
- 429 - Rate limited
- 500 - Server error
- 503 - Service unavailable (readiness failed)

Error codes (machine-readable):

| Code | When |
|------|------|
| `invalid_signature` | Webhook HMAC failure |
| `unknown_repo` | Repo not in registry |
| `project_not_found` | Slug not found |
| `job_not_found` | Job ID not found |
| `run_not_found` | Run ID not found |
| `job_terminal` | Cancel attempted on already-terminal job |
| `unauthorized` | Missing/bad bearer token |
| `rate_limited` | Too many requests |
| `validation_failed` | Request body invalid |
| `internal_error` | Catch-all 500 |

## 11. Auth Details

### Bearer tokens

Issued out of band (env var or admin script for MVP). Header:

```
Authorization: Bearer <token>
```

Token scopes (future):

- `read:projects`
- `read:jobs`
- `write:jobs` (cancel)
- `read:stats`

MVP uses a single all-scopes token.

### GitHub webhook signature

`X-Hub-Signature-256: sha256=<hex>` where hex = HMAC-SHA256 of raw request body using `GITHUB_WEBHOOK_SECRET`. Constant-time comparison required.

## 12. Rate Limits (MVP defaults)

- Webhook endpoints: no rate limit (trust upstream).
- Internal `/v1/*` endpoints: 60 req/min per bearer token.
- Stats endpoint: 10 req/min (cache-friendly anyway).

429 responses include `Retry-After` header in seconds.

## 13. Pagination

Cursor pagination considered for future; MVP uses limit/offset:

```
?limit=50&offset=100
```

All list responses include:

```json
"pagination": { "total": 234, "limit": 50, "offset": 100 }
```

## 14. Future Endpoints (not in MVP)

- `POST /v1/projects` - create project from API (currently file-based)
- `PATCH /v1/projects/:slug` - update config
- `POST /v1/jobs/:jobId/retry` - retry a failed job
- `POST /v1/admin/labels/sync` - trigger label sync across all projects
- `GET /v1/admin/audit` - structured audit feed
