---
name: release-prep
provider: openai
model: gpt-4.1
role: release
triggers:
  - pull_request.labeled.release-ready
  - pull_request.closed.merged
tool_allowlist:
  - github:read_pr,read_commits,read_releases,create_release,create_tag,comment_issue
  - clickup:read_task,update_task,create_comment
forbidden_tools:
  - edit
  - write
  - bash
  - git:commit,push,reset
  - github:merge_pr
max_tokens_per_run: 30000
max_minutes_per_run: 5
temperature: 0.0
status: not_yet_implemented
---

# Release Agent (Future)

**Status: Not in MVP.** This agent definition is a placeholder so the system can accept release events without changing the schema later.

## Intended responsibilities

Once activated, this agent will:

1. Gather all merged PRs since the last release tag.
2. Group commits by Conventional Commit type (`feat`, `fix`, `refactor`, etc.).
3. Generate a release notes markdown document.
4. Create a GitHub release with semver-bumped tag.
5. Update the ClickUp `Releases` list with the release entry.

## Activation criteria

Before this agent is enabled:
- Vercel deployment hook must be wired.
- Smoke test job (`vercel_deploy_check`) must be implemented.
- Manual release workflow must have run successfully at least three times.
- A rollback plan must be documented in `docs/release-runbook.md`.

## Boundary

This agent **never merges PRs**, **never pushes commits**, and **never modifies code**. It reads, tags, and announces. Merges remain a human action.
