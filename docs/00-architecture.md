# ClaudeGPT - Solution Architecture

> Master architecture reference. All other docs in this folder derive from this one. If they ever conflict, this doc wins until updated otherwise.

## 1. Executive Summary

ClaudeGPT is a reusable middleware platform that coordinates AI-assisted software delivery across multiple projects. It connects GitHub, ClickUp, Claude Code, OpenAI, Vercel, Neon and future tools into one controlled delivery loop.

The goal is to move from manual prompt-copying to a structured agent workflow where product tasks become GitHub issues, Claude Code executes implementation, OpenAI reviews the output, and ClickUp stays updated as the operational dashboard.

This architecture is designed to support multiple projects, not just one product.

Supported pilot projects:

- AI Social Media OS
- IdeaFlow
- TradeGenie
- MathAI
- BASIR
- Future ClaudeGPT products

## 2. Core Loop

```
ChatGPT/OpenAI creates GitHub Issue
    -> Issue labeled claude-ready
    -> ClaudeGPT receives webhook
    -> Policy engine validates
    -> Claude Code runner claims task
    -> Claude implements on branch
    -> Runner opens Pull Request
    -> OpenAI QA reviews PR
    -> Fixes requested or approved
    -> ClickUp reflects status
    -> Release flow continues
```

## 3. Principles

1. **GitHub is the engineering source of truth.** Issues, branches, PRs, commits, CI, releases.
2. **ClickUp is the business dashboard.** Roadmaps, priorities, owner actions, release tracking, agent logs.
3. **Middleware owns the workflow.** Event routing, policy checks, agent jobs, status sync.
4. **Agents have constrained power.** Allowed repos only, allowed labels only, trusted triggers, isolated execution, least-privilege tokens, no auto-merge, no destructive operations.
5. **Everything is auditable.** Every run logged with trigger, agent, prompt, files, tests, result.

## 4. Component Map

```
                    ChatGPT / OpenAI PM
                            |
       creates issues / reviews PRs
                            v
  ClickUp <----> ClaudeGPT <----> GitHub
                            |
                       creates jobs
                            v
                       Job Queue
                            |
                            v
                    Claude Code Runner
                            |
                            v
                     Repo Sandbox
                            |
                            v
                    Pull Request
```

## 5. Major Components

- **API Gateway** - Webhook receiver, internal APIs.
- **Webhook Router** - Classifies and dispatches GitHub events.
- **Project Registry** - Per-project configuration store.
- **Policy Engine** - Decides whether automation may run.
- **Task Claim Service** - Ensures one runner per task.
- **Job Queue** - Reliable async work.
- **Claude Code Runner** - Executes implementation.
- **OpenAI QA Reviewer** - Reviews PR diffs.
- **GitHub Integration** - Wraps GitHub API.
- **ClickUp Sync** - Mirrors status to ClickUp.
- **Run Log Service** - Audit trail.

## 6. Label Strategy

See `04-github-labels.md` for the full table. Summary:

- Execution: `claude-ready`, `claude-claimed`, `claude-in-progress`, `claude-complete`, `claude-rework`
- QA: `openai-qa`, `openai-approved`, `openai-changes-requested`
- Control: `blocked`, `needs-nishad`, `do-not-run-agent`, `security-review`, `database-review`, `release-ready`
- Priority: `priority-urgent`, `priority-high`, `priority-normal`, `priority-low`
- Type: `feature`, `bug`, `refactor`, `test`, `docs`, `infra`, `security`, `release`

## 7. Issue Format

Every claude-ready issue must include: Objective, Context, Scope, Out of Scope, Technical Notes, Acceptance Criteria, Testing Requirements, Branch Name, PR Requirements, Definition of Done. See `.github/ISSUE_TEMPLATE/`.

## 8. PR Format

Closes #N, Summary, Files Changed, Tests Run, Screenshots/Logs, Known Limitations, Follow-Up Tasks, Agent Notes.

## 9. Data Model

See `05-database-schema.md` for full SQL. Core tables: `projects`, `agents`, `agent_jobs`, `agent_runs`, `github_events`, `github_issue_mappings`, `github_pr_mappings`, `clickup_mappings`, `run_logs`, `policy_violations`.

## 10. Safety Gates

- **Pre-run:** issue format valid, label correct, trigger user trusted, repo allowed, not already claimed.
- **During-run:** timeout enforced, cost budget enforced, no secret exposure, command audit.
- **Post-run:** lint/typecheck/test/secret-scan pass, PR opened (no direct merge).
- **Merge:** OpenAI QA approval, human approval for high-risk, CI green, no critical comments open.

## 11. Deployment

**MVP:** Next.js or Node API on Vercel/Railway/Render, Postgres on Neon, Redis on Upstash, GitHub App, ClickUp API.

**Production:** API + dedicated workers, ephemeral runner containers, object storage for logs, observability platform, secrets manager.

## 12. MVP Scope

In scope: webhook endpoint, project registry, claude-ready trigger, policy validation, job queue, Claude runner, branch + PR creation, basic OpenAI QA, basic ClickUp sync, run logs.

Out of scope: full admin UI, multi-agent routing beyond Claude/OpenAI, auto-merge, production deployment automation, two-way ClickUp sync, advanced analytics, sandbox network isolation.

## 13. Build Phases

1. Core webhook + registry
2. Policy + job queue
3. Claude runner
4. OpenAI QA
5. ClickUp sync
6. Hardening

## 14. First Milestone

```
Label a GitHub issue as claude-ready
  -> Claude Code creates PR
  -> OpenAI reviews PR
```

Once that loop works, everything else is scaling and polish.
