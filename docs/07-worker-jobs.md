# Worker Job Specification

> Every async unit of work in ClaudeGPT is a job. This doc defines every job type, its payload, its lifecycle, its retry rules, and what hooks fire around it.

Queue: BullMQ on Redis. Workers are stateless Node processes that pull jobs and run them. Each worker can handle multiple job types but in production we'll separate by queue for isolation.

## 1. Job Types

| Type | Triggered By | Agent | Purpose |
|------|-------------|-------|---------|
| `claude_implement_issue` | `claude-ready` label on issue | claude-code | Build the feature, open PR |
| `claude_rework_pr` | `claude-rework` label on PR | claude-code | Apply QA feedback to existing PR |
| `openai_qa_review` | PR opened or `openai-qa` label | openai-qa | Review the PR diff |
| `clickup_sync` | Any status change | clickup-sync | Mirror state to ClickUp |
| `vercel_deploy_check` | Deployment webhook (future) | internal | Wait for deploy, run smoke tests |
| `neon_migration_review` | DB-touching PR (future) | internal | Static analysis on migrations |
| `release_prep` | `release-ready` label (future) | internal | Generate release notes, tag |

MVP implements the first three. Rest are stubs.

## 2. Common Job Shape

Every job stored in `agent_jobs` table. BullMQ wraps that row with retry metadata.

```ts
type Job = {
  id: string;                    // UUID from agent_jobs.id
  project_id: string;
  agent_id: string;
  job_type: JobType;
  status: JobStatus;
  priority: number;              // lower = more urgent (BullMQ convention)
  github_repo: string;
  github_issue_number?: number;
  github_pr_number?: number;
  clickup_task_id?: string;
  payload_json: Record<string, unknown>;
  created_at: string;
  started_at?: string;
  completed_at?: string;
};
```

## 3. Job Lifecycle

```
queued -> running -> (succeeded | failed | blocked | cancelled)
```

State transitions:

- `queued -> running` - worker picks up job, sets `started_at`.
- `running -> succeeded` - job finished, all post-conditions met.
- `running -> failed` - job hit a recoverable error; retry count not exhausted.
- `running -> blocked` - policy or external state requires owner input. No retry.
- `running -> cancelled` - explicit cancel via API.
- `queued -> cancelled` - cancelled before running.

A job in `failed` state may transition back to `queued` if retries remain.

## 4. Retry Rules

| Job Type | Max Attempts | Backoff |
|----------|--------------|---------|
| `claude_implement_issue` | 1 | no auto-retry (manual via owner) |
| `claude_rework_pr` | 1 | no auto-retry |
| `openai_qa_review` | 3 | exponential, base 30s |
| `clickup_sync` | 5 | exponential, base 10s, cap 5min |
| `vercel_deploy_check` | 3 | exponential, base 60s |

**Why Claude jobs don't auto-retry:** A Claude run produces real git history. Auto-retrying is dangerous — the second attempt might fight the first. Failed Claude jobs require a human (or owner) to inspect and re-trigger.

## 5. Timeouts

| Job Type | Default | Override |
|----------|---------|----------|
| `claude_implement_issue` | 30 min | `config_json.limits.maxRunMinutes` |
| `claude_rework_pr` | 20 min | same |
| `openai_qa_review` | 5 min | `config_json.limits.maxQaMinutes` |
| `clickup_sync` | 30 sec | hardcoded |
| `vercel_deploy_check` | 15 min | hardcoded |

Timeout = job moves to `failed` with `error_message: "timeout"`. Runner process gets SIGTERM, then SIGKILL after 10s grace.

## 6. Payload Schemas

### 6.1 `claude_implement_issue`

```json
{
  "issue": {
    "number": 12,
    "title": "Task 01: Project Setup",
    "body": "...full issue body...",
    "labels": ["claude-ready", "feature", "priority-high"],
    "url": "https://github.com/..."
  },
  "trigger": {
    "event_type": "issues.labeled",
    "user": "nishadsukumaran",
    "applied_label": "claude-ready",
    "delivery_id": "abc-123"
  },
  "branch_name": "feature/issue-12-project-setup",
  "policy_decision": {
    "approved": true,
    "checks_passed": ["repo_allowed", "user_trusted", "format_valid", "not_claimed"]
  }
}
```

### 6.2 `claude_rework_pr`

```json
{
  "pr": {
    "number": 34,
    "title": "[12] Project Setup",
    "head_branch": "feature/issue-12-project-setup",
    "url": "https://github.com/..."
  },
  "issue": { /* same shape as above */ },
  "qa_feedback": {
    "run_id": "uuid",
    "summary": "Missing tests for AuthService.login",
    "required_changes": [
      "Add unit test covering invalid password path",
      "Handle expired session token in middleware"
    ],
    "non_blocking_suggestions": [
      "Rename `tmpUser` -> `pendingUser` for clarity"
    ]
  },
  "trigger": { /* same shape as above */ }
}
```

### 6.3 `openai_qa_review`

```json
{
  "pr": {
    "number": 34,
    "title": "[12] Project Setup",
    "head_branch": "feature/issue-12-project-setup",
    "base_branch": "main",
    "url": "https://github.com/...",
    "diff_url": "https://api.github.com/..."
  },
  "issue": { /* parent issue */ },
  "project_context": {
    "architecture_doc_path": "docs/00-architecture.md",
    "agent_policy_path": ".claudegpt/agent-policy.md"
  },
  "trigger": { /* same shape */ }
}
```

### 6.4 `clickup_sync`

```json
{
  "github_repo": "nishadsukumaran/ai-social-media-os",
  "github_issue_number": 12,
  "github_pr_number": 34,
  "clickup_task_id": "abc123",
  "new_status": "qa",
  "comment": "Claude has opened PR #34. Currently in OpenAI QA review."
}
```

## 7. Job-Level Hooks

Each job lifecycle exposes hooks. Hooks are sync functions that can short-circuit the job (return non-null = job blocked with that reason).

```ts
type JobHook = (job: Job) => Promise<{ block: false } | { block: true; reason: string }>;
```

### Pre-execution hooks (run in order)

| Hook | What it does | Job types |
|------|--------------|-----------|
| `verifyProjectActive` | Project must be `active` status | all |
| `verifyAgentEnabled` | Agent must be `enabled` | all |
| `verifyNotDuplicate` | No other running job for same issue/PR | all |
| `verifyBudget` | Project has not exceeded cost limits | claude_* |

### Mid-execution hooks (called by runner at named points)

| Hook | What it does | Job types |
|------|--------------|-----------|
| `pre-edit` | Snapshot git status, refuse if dirty | claude_implement, claude_rework |
| `post-edit` | Run formatter, list changed files | claude_* |
| `pre-commit` | Secret scan, block `.env` files | claude_* |
| `pre-push` | Verify branch name, refuse default branch | claude_* |
| `pre-pr` | Verify validation chain passed | claude_* |

### Post-execution hooks

| Hook | What it does | Job types |
|------|--------------|-----------|
| `recordCost` | Sum tokens, write to `agent_runs.cost_usd` | claude_*, openai_* |
| `updateMappings` | Update `github_*_mappings` rows | all |
| `triggerClickupSync` | Enqueue follow-up `clickup_sync` job | claude_*, openai_* |
| `cleanupWorkspace` | Delete runner working directory | claude_* |

## 8. Concurrency

| Job Type | Concurrent per project | Concurrent global |
|----------|----------------------|-------------------|
| `claude_implement_issue` | 1 | 3 |
| `claude_rework_pr` | 1 | 3 |
| `openai_qa_review` | 3 | 10 |
| `clickup_sync` | 5 | 20 |

The "1 per project" rule for Claude jobs prevents two implementations from racing in the same repo. Combined with the `task_claims` unique constraint at the DB level, it's belt and suspenders.

## 9. Failure Categories

| Category | Examples | Status | Retry? |
|----------|----------|--------|--------|
| Transient | Network timeout, rate limit, 5xx from API | `failed` | yes (per table above) |
| Validation | Issue body invalid, label mismatch | `blocked` | no |
| Policy | Untrusted user, unknown repo | `blocked` | no |
| Agent error | Claude returned malformed output, tests failed | `failed` | no for Claude, yes for QA |
| Owner | `needs-nishad` applied mid-run | `blocked` | no |
| Resource | Workspace disk full, OOM | `failed` | yes once |

## 10. Runner Sub-steps (for `claude_implement_issue`)

Each step writes a `run_logs` entry with `source` matching the step name.

| Step | Source | Failure handling |
|------|--------|-----------------|
| `runner.workspace.create` | new isolated directory | fail = retry once |
| `runner.git.clone` | shallow clone of repo | fail = blocked, comment on issue |
| `runner.git.branch` | create feature branch | fail = blocked |
| `runner.context.load` | load CLAUDE.md, agent-policy, issue | fail = blocked |
| `runner.claude.invoke` | run Claude Code with prompt | fail = failed, log full output |
| `runner.validate.lint` | run lint command | fail = PR stays draft |
| `runner.validate.typecheck` | run typecheck | fail = PR stays draft |
| `runner.validate.test` | run tests | fail = PR stays draft |
| `runner.validate.build` | run build | fail = PR stays draft |
| `runner.secrets.scan` | gitleaks or similar | fail = blocked, no push |
| `runner.git.commit` | commit changes | fail = failed |
| `runner.git.push` | push to remote | fail = retry once |
| `runner.pr.open` | open PR via GitHub API | fail = retry once |
| `runner.issue.comment` | comment with PR link | fail = log, not fatal |
| `runner.workspace.cleanup` | delete workspace | always runs |

## 11. Runner Sub-steps (for `openai_qa_review`)

| Step | Source |
|------|--------|
| `qa.fetch.pr` | get PR metadata via GitHub API |
| `qa.fetch.diff` | get unified diff |
| `qa.fetch.issue` | get parent issue body |
| `qa.fetch.context` | load architecture + agent policy from repo |
| `qa.openai.invoke` | send to OpenAI with QA prompt |
| `qa.parse` | parse structured output (pass/fail + comments) |
| `qa.comment` | post review comment on PR |
| `qa.labels` | apply `openai-approved` or `openai-changes-requested` + `claude-rework` |
| `qa.followup` | enqueue `clickup_sync` |

## 12. Prompt Templates

### `claude_implement_issue` prompt

```
You are Claude Code working under ClaudeGPT.

Project: {{projectName}}
Repository: {{repo}}
Issue: #{{issueNumber}} - {{issueTitle}}
Branch: {{branchName}}

Read the issue fully. Read CLAUDE.md and .claudegpt/agent-policy.md.

Implement only the requested scope.
Do not build out-of-scope features.
Do not modify secrets.
Do not commit .env files.
Do not perform destructive database operations.

Acceptance criteria must be satisfied before you stop.
Run lint, typecheck, tests, build before declaring done.

When complete, output a structured summary:
1. Summary (2-4 sentences)
2. Files changed (list)
3. Tests run (commands + result)
4. Known limitations
5. Follow-up tasks

---
ISSUE BODY:
{{issueBody}}
```

### `openai_qa_review` prompt

```
You are the QA reviewer for ClaudeGPT.

Project: {{projectName}}
Issue: #{{issueNumber}} - {{issueTitle}}
PR: #{{prNumber}} - {{prTitle}}

Your job: verify the PR satisfies the issue's acceptance criteria and respects the agent policy.

Return JSON with this exact shape:
{
  "result": "pass" | "fail",
  "summary": "string, 2-4 sentences",
  "critical_issues": [{ "file": "...", "line": 12, "issue": "..." }],
  "non_blocking_suggestions": ["string"],
  "security_concerns": ["string"],
  "missing_tests": ["string"],
  "scope_violations": ["string"]
}

Critical issues = block the merge.
Non-blocking = nice-to-have.

If `scope_violations` is non-empty, result must be "fail".

---
ISSUE BODY:
{{issueBody}}

---
PR DIFF:
{{prDiff}}

---
AGENT POLICY:
{{agentPolicy}}
```

## 13. Observability

Per job, emit metrics:

- `job.created` (counter, tags: `type`, `project`)
- `job.completed` (counter, tags: `type`, `project`, `status`)
- `job.duration_seconds` (histogram, tags: `type`, `project`)
- `job.tokens_used` (counter, tags: `type`, `project`)
- `job.cost_usd` (counter, tags: `type`, `project`)

Per run, emit a structured log line per sub-step.

## 14. Job Worker Code Skeleton

```ts
// apps/api/src/workers/claude-implement-issue.ts
import { Worker } from 'bullmq';
import { runClaudeImplement } from '../runners/claude';

export const claudeImplementWorker = new Worker(
  'claude_implement_issue',
  async (job) => {
    const ctx = job.data as ImplementPayload;
    await runHooks('pre-execution', ctx);
    const result = await runClaudeImplement(ctx);
    await runHooks('post-execution', ctx, result);
    return result;
  },
  {
    connection: redisConnection,
    concurrency: 3,
    lockDuration: 30 * 60 * 1000, // 30 min
  }
);

claudeImplementWorker.on('failed', async (job, err) => {
  await markJobFailed(job!.id, err);
  await commentOnIssue(job!.data, err);
});
```

## 15. Future Job Types

These are stubbed for now and will be added in later phases:

- `vercel_deploy_check` - after merge, watch deploy, run smoke tests.
- `neon_migration_review` - static SQL analysis for migration PRs.
- `release_prep` - bundle PRs into a release, generate changelog, tag.
- `agent_self_test` - daily synthetic run to verify the pipeline still works.
- `cost_report` - weekly per-project cost summary to ClickUp.
