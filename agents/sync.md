---
name: clickup-sync
provider: internal
model: none
role: sync
triggers:
  - issue.labeled.claude-claimed
  - issue.labeled.claude-complete
  - issue.labeled.blocked
  - issue.labeled.needs-nishad
  - pull_request.opened
  - pull_request.labeled.openai-qa
  - pull_request.labeled.openai-approved
  - pull_request.labeled.claude-rework
  - pull_request.closed
tool_allowlist:
  - clickup:read_task,update_task,create_comment,move_task
forbidden_tools:
  - clickup:delete_task,delete_list,delete_folder
  - edit
  - write
  - bash
  - git
  - github
max_tokens_per_run: 0
max_minutes_per_run: 2
---

# Sync Agent

This agent is **not** an LLM. It is a deterministic worker that mirrors GitHub state into ClickUp. It lives in the same agent registry for symmetry and audit logging, but its prompt is a no-op.

## Behavior

On each trigger, the orchestrator hands the sync agent a payload:

```json
{
  "github_repo": "owner/repo",
  "github_issue_number": 12,
  "github_pr_number": 34,
  "clickup_task_id": "abc123",
  "new_status": "qa",
  "trigger_event": "pull_request.labeled.openai-qa",
  "comment": "PR #34 opened, OpenAI QA in progress."
}
```

It looks up the ClickUp task, moves it to the mapped list/status, and appends a comment. That's it.

## Status mapping

The mapping lives in the project config (`config_json.clickup_status_map`). Default mapping:

| GitHub event | ClickUp status |
|--------------|---------------|
| `issue.labeled.claude-ready` | Ready for Claude Build |
| `issue.labeled.claude-claimed` | In Claude Build |
| `pull_request.opened` | OpenAI QA Review |
| `pull_request.labeled.openai-approved` | Build Complete |
| `pull_request.labeled.claude-rework` | Rework |
| `issue.labeled.blocked` | Blocked |
| `issue.labeled.needs-nishad` | Nishad Actions & Setup Inputs |
| `pull_request.closed.merged` | Released |

## Failure handling

If the ClickUp API call fails:
- Retry per the BullMQ retry table (5 attempts, exponential backoff, cap 5min).
- After 5 failures, log to `run_logs` with `level: error` and stop. GitHub remains source of truth — ClickUp drift is non-fatal.

## Why this is an "agent"

Treating sync as an agent gives us:
- One audit log shape across all roles.
- One retry/concurrency policy.
- Easy upgrade path if we ever want LLM-driven natural-language ClickUp comments.

If we don't add LLM behavior here within 6 months, demote to plain worker.
