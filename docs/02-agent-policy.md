# ClaudeGPT - Agent Policy

> Every agent operating under ClaudeGPT (Claude Code, OpenAI QA, future agents) must comply with this policy. The orchestrator's Policy Engine enforces what it can programmatically. Anything that cannot be auto-enforced is enforced by review.

This file should also be present at `.claudegpt/agent-policy.md` inside every project repo so the agent loads it before each run.

## 1. Allowed Actions

An agent **may**:

1. Read any file in the repository on the working branch.
2. Create, modify, or delete files inside the working tree, **except** the blocked paths in section 3.
3. Run commands defined in the project config under `commands` (install, lint, typecheck, test, build).
4. Create new git branches matching the configured `branchPrefix`.
5. Commit and push to the agent's own feature branch.
6. Open a pull request targeting the configured `defaultBranch`.
7. Comment on the GitHub issue and PR linked to the current run.
8. Update labels listed in the project config `labels` block.

## 2. Blocked Actions (Hard Stop)

An agent **must not**:

1. Push directly to `main`, `master`, `production`, `release`, or any branch matching `release/*`.
2. Force-push to any branch.
3. Delete branches it did not create.
4. Merge any pull request.
5. Modify or read files matching `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets/**`, or any path the project config lists under `paths.protected`.
6. Commit values that look like API keys, tokens, private keys, passwords, OAuth secrets, AWS credentials, or database URLs.
7. Run database migrations against production databases.
8. Delete user data, customer records, or any table.
9. Call third-party services that move money, send messages to real users, or modify external infrastructure unless explicitly listed in the issue scope.
10. Modify `.github/workflows/**` without the `infra` label on the parent issue.
11. Modify CI secrets, GitHub App settings, or webhook configurations.
12. Touch authentication, authorization, or session handling unless the issue has the `security` label and `needs-nishad` has been resolved.
13. Modify billing, payment, or subscription logic without the `security` + `needs-nishad` flow completed.

If the task as written in the issue requires any of the above, the agent must stop and post a comment requesting `needs-nishad` instead of attempting it.

## 3. Blocked Paths (Default Allowlist Pattern)

Default blocklist (project config can extend, never shrink):

```
.env
.env.*
.env.local
.env.production
.env.staging
*.pem
*.key
*.p12
*.pfx
secrets/**
.claudegpt/secrets/**
config/secrets/**
infrastructure/secrets/**
.github/workflows/**   (write blocked unless infra label present)
```

## 4. Scope Discipline

1. The agent implements **only** what is in the `Scope` section of the issue.
2. The `Out of Scope` section is binding. The agent must not add work listed there even if it seems obvious or easy.
3. If the agent discovers that the requested change requires touching out-of-scope code or systems, it must stop, comment on the issue describing the dependency, and request a new issue rather than expanding the current one.
4. Refactors are only allowed inside files the agent is already touching to complete the task, and only when needed to make the task work. Standalone "while I'm here" cleanups are blocked.

## 5. Branch and PR Rules

1. Branch name format: `{branchPrefix}/issue-{issueNumber}-{kebab-slug}`.
2. One branch per issue. No reusing branches across issues.
3. PR title format: `[{issueNumber}] {issueTitle}`.
4. PR description must follow the template in `00-architecture.md` section 8 (Closes, Summary, Files Changed, Tests Run, Screenshots, Known Limitations, Follow-Up, Agent Notes).
5. PR must link the parent issue with `Closes #N`.
6. PR is **draft** until validation commands all pass. Mark ready-for-review only when lint + typecheck + tests + build all return zero.

## 6. Validation Before PR

Before opening or marking a PR ready, the agent must run, in order:

1. `commands.install` if present
2. `commands.lint`
3. `commands.typecheck`
4. `commands.test`
5. `commands.build`
6. Secret scan (orchestrator-level pre-commit hook)

Any non-zero exit = PR stays draft, agent posts a comment with the failing output, and the run is marked `failed`. No retry without human ack.

## 7. Commit Hygiene

1. One logical change per commit where reasonable.
2. Commit messages follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`, `ci:`.
3. Body must reference the issue: `Refs #N` or `Closes #N`.
4. No commits with messages like "wip", "fix stuff", "updates", "changes".
5. No commits that include `console.log` debugging, `print()` debug lines, or commented-out blocks unless the issue asks for them.

## 8. Test Discipline

1. Every new function or component must have at least one test unless the issue explicitly states otherwise.
2. Tests must hit real implementations where the issue specifies. Do not mock around behavior that the issue is asking the agent to verify.
3. Snapshot tests are allowed only when the issue explicitly mentions them.
4. Tests live alongside source per the project convention (check `paths.tests` in project config).

## 9. Secrets and Tokens

1. The agent receives no production secrets. Ever.
2. Local `.env.example` files must show keys but never values.
3. If a feature needs a new secret, the agent adds the key to `.env.example` and lists it in the PR's `Known Limitations` section as "owner must set this before deploy".

## 10. Owner-Approval Triggers (`needs-nishad`)

The agent must label the issue `needs-nishad` and stop if it encounters any of:

- Database schema changes affecting existing tables with data
- Auth, sessions, OAuth, password, JWT, or token logic
- Billing, payment, subscription, refund logic
- Email, SMS, push, or any user-facing communication going to real users
- External API key addition or rotation
- Infrastructure files (terraform, docker, k8s, github workflows) for the first time in a repo
- Anything labeled `security`, `database-review`, or `release-ready`
- Estimated diff > 30 files or > 1500 lines
- Issue scope unclear or acceptance criteria missing

## 11. Hook Points

Orchestrator-level Claude Code hooks must run:

| Hook | What runs |
|------|-----------|
| `pre-execution` | Load `.claudegpt/agent-policy.md`, confirm branch name format, confirm issue is unclaimed |
| `pre-edit` | Snapshot `git status`, confirm clean working tree |
| `post-edit` | Run formatter, run linter, list files changed |
| `pre-commit` | Secret scan, block `.env` files, ensure tests have run on the changed paths |
| `pre-push` | Verify branch matches `branchPrefix` config, confirm not pushing to `defaultBranch` |
| `post-pr` | Update issue with PR link, update run log, comment on ClickUp task |

## 12. Cost and Time Limits

| Limit | Default | Override |
|-------|---------|----------|
| Max wall-clock per run | 30 minutes | Project config `limits.maxRunMinutes` |
| Max token spend per run | 200,000 tokens | Project config `limits.maxTokens` |
| Max file changes per PR | 25 | Project config `limits.maxFiles` |
| Max LOC changes per PR | 1500 | Project config `limits.maxLines` |

Hitting any limit = run halts, issue gets `needs-nishad`, no partial PR.

## 13. Failure Behavior

If the agent encounters something it cannot resolve:

1. Stop. Do not guess.
2. Post a comment on the issue explaining what went wrong, what was tried, and what input is needed.
3. Add the `blocked` label.
4. If owner input is needed, add `needs-nishad`.
5. Do not push partial work.

## 14. Audit Requirements

For every run, the orchestrator stores:

- Trigger event payload
- Trigger user
- Project ID and repo
- Prompt snapshot sent to the agent
- All commands executed and their exit codes
- File diff
- Test output summary
- Final status and reason

The agent has no power to suppress or modify these logs.

## 15. Policy Updates

This policy can only be updated by:

1. A PR to `claudegpt` that updates `docs/02-agent-policy.md`
2. Approved by Nishad
3. Version-tagged in the file frontmatter (when added)

No agent may propose changes to its own policy.
