# Plugins, Hooks, and Multi-Agent Architecture

> ClaudeGPT runs as a layered system. The orchestrator service is the brain. Inside every target repo, a Claude Code **plugin** enforces local rules via **hooks**, and multiple **agents** divide responsibilities. This doc maps the three layers and explains how they wire together.

## 1. Three Layers

```
+---------------------------------------------------+
|  Layer 1: Orchestrator Service (Node API)         |
|  - Webhook receiver, job queue, runner orchestration |
|  - Lives in this repo's apps/api (when code lands) |
+---------------------------------------------------+
                       |
                       | invokes Claude Code with
                       | --plugin claudegpt-policy
                       v
+---------------------------------------------------+
|  Layer 2: Claude Code Plugin (claudegpt-policy)   |
|  - Installed in every target repo at .claude/plugins/ |
|  - Provides hooks, slash commands, agent presets   |
+---------------------------------------------------+
                       |
                       | hooks intercept agent activity
                       v
+---------------------------------------------------+
|  Layer 3: Multi-Agent Topology                    |
|  - claude-builder, openai-reviewer, clickup-sync,  |
|    release-prep, agent-watchdog                    |
|  - Each agent has its own prompt + tool allowlist  |
+---------------------------------------------------+
```

## 2. External Connectors Needed (Cowork side)

For *operating* the orchestrator from Cowork (testing, debugging, manually nudging tasks), these MCP connectors should be installed:

| Connector | Status | Why |
|-----------|--------|-----|
| Neon | connected | Postgres for orchestrator DB |
| Supabase | connected | Alternative DB option (pick one) |
| Vercel | connected | Deployment target for the API service |
| **ClickUp** | **needed** | Manual sync inspection + task creation |
| **Slack** | optional | Run notifications, incident pings |
| Figma | connected | Architecture diagrams (nice to have) |
| Microsoft Learn | connected | Reference docs |

**GitHub note:** No MCP connector needed. The orchestrator service authenticates to GitHub via a GitHub App with installation tokens — that's the production path and bypasses the Cowork connector entirely.

## 3. Claude Code Plugin Structure

Every project repo registered with ClaudeGPT installs the **claudegpt-policy** plugin under `.claude/plugins/claudegpt-policy/`. The plugin is reusable across repos — one source of truth maintained in this orchestrator repo.

```
.claude/plugins/claudegpt-policy/
  plugin.json              # Plugin metadata
  hooks/
    pre-execution.js       # Validate before Claude runs
    pre-edit.js            # Snapshot git state
    post-edit.js           # Lint + format
    pre-commit.js          # Secret scan, .env block
    pre-push.js            # Branch name guard
    pre-pr.js              # Validation chain check
    post-pr.js             # Update issue + run log
  commands/
    claude-status.md       # /claude-status slash command
    claude-handoff.md      # /claude-handoff slash command
    claude-bail.md         # /claude-bail emergency stop
  agents/
    builder.md             # Claude builder agent preset
    rework.md              # Rework-mode agent preset
  policies/
    blocked-paths.json     # Path patterns the agent must not touch
    risk-keywords.json     # Keywords that trigger needs-nishad
  README.md
```

**Distribution:** the plugin source lives at `plugins/claudegpt-policy/` in this repo. A `scripts/install-plugin.ts` syncs it into target repos on first registration and on every plugin version bump.

## 4. plugin.json Shape

```json
{
  "name": "claudegpt-policy",
  "version": "0.1.0",
  "description": "Enforces ClaudeGPT agent policy via hooks, slash commands, and agent presets.",
  "owner": "nishad",
  "hooks": {
    "pre-execution": "hooks/pre-execution.js",
    "pre-edit": "hooks/pre-edit.js",
    "post-edit": "hooks/post-edit.js",
    "pre-commit": "hooks/pre-commit.js",
    "pre-push": "hooks/pre-push.js",
    "pre-pr": "hooks/pre-pr.js",
    "post-pr": "hooks/post-pr.js"
  },
  "commands": [
    "commands/claude-status.md",
    "commands/claude-handoff.md",
    "commands/claude-bail.md"
  ],
  "agents": [
    "agents/builder.md",
    "agents/rework.md"
  ],
  "config_files": [
    "policies/blocked-paths.json",
    "policies/risk-keywords.json"
  ]
}
```

## 5. Full Hook Inventory

Each hook is a small Node script that reads context from stdin/env, runs its check, and exits 0 (continue) or non-zero (block). Block exits write a structured message to stdout that the orchestrator surfaces in the run log and on the GitHub issue.

| Hook | When it fires | What it checks | Exit codes |
|------|---------------|----------------|------------|
| `pre-execution` | Before Claude is invoked | Branch name format, issue scope present, not already claimed, project active | 0 = OK, 1 = block, 2 = needs-nishad |
| `pre-edit` | Before any file edit | Working tree clean (no untracked junk), git status snapshot stored | 0 = OK, 1 = block |
| `post-edit` | After each edit batch | Formatter runs, linter runs, diff summary captured | 0 = OK, 1 = warn, 2 = block |
| `pre-commit` | Before git commit | Secret scan (gitleaks or similar), `.env*` block, large-file block | 0 = OK, 1 = block |
| `pre-push` | Before git push | Branch matches `branchPrefix`, not pushing to default branch, no force-push | 0 = OK, 1 = block |
| `pre-pr` | Before opening PR | All validation commands passed, PR body template populated, file/line caps not exceeded | 0 = OK, 1 = block |
| `post-pr` | After PR opens | Comment on issue with PR link, write run log, trigger ClickUp sync | 0 = OK (informational) |

### 5.1 Hook stdin contract

Every hook receives a JSON blob on stdin:

```json
{
  "hook": "pre-commit",
  "run_id": "uuid",
  "project_id": "uuid",
  "repo": "owner/repo",
  "branch": "feature/issue-12-project-setup",
  "issue_number": 12,
  "files_changed": ["src/index.ts", "tests/hello.test.ts"],
  "diff_stats": { "files": 2, "additions": 18, "deletions": 0 }
}
```

### 5.2 Hook stdout contract (block case)

```json
{
  "block": true,
  "reason": "Detected potential secret in src/config.ts:42 — value matches AWS access key pattern.",
  "suggested_label": "blocked",
  "needs_owner": false
}
```

### 5.3 Hook stdout contract (continue case)

Exit 0, no output required. Optional structured warnings:

```json
{
  "block": false,
  "warnings": ["lint emitted 2 warnings in src/utils.ts"]
}
```

## 6. Multi-Agent Topology

Five agents, each with a narrow role. None of them can do another's job — separation enforced by tool allowlists and prompt scoping.

| Agent | Provider | Role | Triggers | Tool Allowlist |
|-------|----------|------|----------|---------------|
| `claude-builder` | Anthropic Claude | Implements GitHub issues into PRs | `claude-ready` label on issue | Read, Edit, Write, Bash (restricted), git, package manager |
| `openai-reviewer` | OpenAI | QA reviews Claude PRs | PR opened, `openai-qa` label | GitHub API (read), no Edit/Write |
| `claude-rework` | Anthropic Claude | Applies QA feedback to existing PR | `claude-rework` label on PR | Same as builder, scoped to PR's branch |
| `clickup-sync` | Internal (no LLM) | Mirrors GitHub state to ClickUp | Status change events | ClickUp API only |
| `release-prep` | OpenAI (future) | Generates release notes, tags | `release-ready` label, merge to main | GitHub API (write tags), no code edit |

### 6.1 Agent definition file format

Each agent has a markdown definition under `agents/` with frontmatter:

```markdown
---
name: claude-builder
provider: anthropic
model: claude-sonnet-4-6
role: builder
triggers:
  - issue.labeled.claude-ready
tool_allowlist:
  - read
  - edit
  - write
  - bash:install,lint,typecheck,test,build
  - git:branch,commit,push
  - github:create_pr,comment_issue
max_tokens_per_run: 200000
max_minutes_per_run: 30
---

You are the builder agent for ClaudeGPT. Implement the issue exactly as scoped.

[full prompt body...]
```

### 6.2 Why no single "super agent"

Single-agent orchestrators concentrate risk — one bad prompt or one runaway loop can do everything. Splitting roles means:

- Builder has no GitHub merge access.
- Reviewer has no code edit access.
- Sync has no LLM access at all.
- Release-prep cannot modify code.

Each agent is the smallest viable surface for its job.

## 7. Hook + Agent Interaction Sequence

A successful `claude-builder` run, hook by hook:

```
1. Orchestrator dequeues claude_implement_issue job
2. Spawn Claude Code with --plugin claudegpt-policy
3. Run hooks/pre-execution.js
   - Validates branch, issue, claim state
   - Exit 0 -> continue
4. Claude reads CLAUDE.md, agent-policy, issue body
5. Claude begins editing
   For each edit batch:
     a. Run hooks/pre-edit.js (snapshot git status)
     b. Claude edits files
     c. Run hooks/post-edit.js (format + lint)
6. Claude announces completion
7. Run validation chain: install -> lint -> typecheck -> test -> build
   - Failures bubble up, PR stays draft
8. Run hooks/pre-commit.js (secret scan, .env block)
   - Block -> halt, comment on issue
9. Git commit
10. Run hooks/pre-push.js (branch guard)
    - Block -> halt
11. Git push
12. Run hooks/pre-pr.js (final validation gate)
    - Block -> halt, no PR
13. Open PR via GitHub API
14. Run hooks/post-pr.js (issue comment, run log, ClickUp trigger)
15. Job marked succeeded
```

## 8. Slash Commands (Inside Target Repos)

Three slash commands ship with the plugin. They run inside the Claude Code session, not on the orchestrator side.

| Command | Purpose |
|---------|---------|
| `/claude-status` | Print the current run state, branch, issue link, hook log |
| `/claude-handoff` | Cleanly hand off mid-run (rare — usually means owner is taking over) |
| `/claude-bail` | Emergency abort — undo uncommitted changes, drop branch, label `blocked` |

## 9. Policy Data Files

### 9.1 `policies/blocked-paths.json`

Extends `docs/02-agent-policy.md` section 3. Same blocklist, machine-readable form:

```json
{
  "version": 1,
  "patterns": [
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "secrets/**",
    ".claudegpt/secrets/**",
    "config/secrets/**",
    "infrastructure/secrets/**"
  ],
  "conditional": {
    ".github/workflows/**": "require_label:infra"
  }
}
```

### 9.2 `policies/risk-keywords.json`

Keywords in issue title/body that auto-apply `needs-nishad`:

```json
{
  "version": 1,
  "keywords": [
    "production database",
    "drop table",
    "delete user",
    "billing",
    "payment",
    "stripe",
    "refund",
    "oauth secret",
    "private key",
    "rotate token",
    "force push",
    "delete branch"
  ]
}
```

Match is case-insensitive substring.

## 10. Wiring Plugin Into Target Repos

A script in `scripts/install-plugin.ts` (to be authored when code lands) does:

```
For each project in projects/*.json:
  1. Resolve GitHub repo
  2. Open PR on that repo:
     - Adds/updates .claude/plugins/claudegpt-policy/* from this repo
     - Adds .claudegpt/agent-policy.md (symlink or copy)
     - Adds CLAUDE.md if missing
  3. Tag PR with `infra` label
  4. PR requires human merge (per agent policy section 2.1)
```

The orchestrator never installs the plugin silently. The owner reviews the install PR like any other infra change.

## 11. Plugin Versioning

The plugin uses semver. Version stored in `plugin.json`. On version bump:

1. Update `version` field.
2. Add entry to `plugins/claudegpt-policy/CHANGELOG.md`.
3. Run `scripts/install-plugin.ts` to open update PRs in every registered repo.

Breaking changes (e.g., new required hook, blocked-paths schema change) require major bump and explicit migration notes per project.

## 12. Hook Failure Surface

When a hook blocks, the orchestrator does the following automatically:

1. Capture the structured stdout from the hook.
2. Write a `run_logs` row with `level: error`, `source: hook.{name}`.
3. Comment on the GitHub issue or PR with the block reason.
4. Apply the suggested label (default `blocked`; `needs-nishad` if owner action required).
5. Mark the job `blocked` or `failed` per the hook's exit code.
6. No retry.

The agent itself never sees the hook block message — the orchestrator handles it. This prevents an agent from "reading" a hook failure and trying to route around it.

## 13. Observability for Plugin/Hook Layer

Per hook invocation, emit:

- `hook.invoked` counter, tags: `name`, `project`, `result` (`pass|block|warn`)
- `hook.duration_ms` histogram, tags: `name`, `project`

Hook timeouts (default 30s per hook) are treated as blocks. Slow hooks indicate a bug — alert if p95 > 5s.

## 14. Future Hook Points

Not in MVP, listed so the schema can accommodate them:

| Hook | Purpose |
|------|---------|
| `pre-test` | Capture test runtime estimate, skip if flagged |
| `post-test` | Parse test results, store as artifact |
| `pre-deploy` | Verify deploy preconditions (run only when `release-prep` job fires) |
| `post-deploy` | Smoke test, update release notes |
| `audit-snapshot` | Daily — snapshot agent runs for compliance archive |

## 15. Why This Layered Design

Three reasons separation matters:

1. **Blast radius.** A bad change in the orchestrator code does not bypass the plugin's per-repo hooks. A bad plugin update does not bypass the orchestrator's policy engine. Two independent gates.
2. **Per-project customization.** Different projects can extend `blocked-paths.json` and `risk-keywords.json` without forking the whole orchestrator.
3. **Replaceability.** If Claude Code changes its plugin spec, only Layer 2 moves. Orchestrator and agent definitions stay stable.

## 16. Open Items

- Pick a secret-scanning library (gitleaks, trufflehog, or a Node-native option).
- Decide hook script language: Node JS (matches orchestrator) or POSIX shell (more portable). Recommend Node for now.
- Plugin install script could use `octokit` for opening the install PR.
- Should `clickup-sync` be a true agent or just a worker? Currently treated as agent for symmetry; could be demoted to plain worker if it never needs an LLM call.
