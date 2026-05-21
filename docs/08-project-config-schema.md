# Project Config Schema

> Every project registered with ClaudeGPT has a JSON config that lives in `projects/{slug}.json` (MVP) or in the `projects.config_json` column (production). This doc is the canonical schema. The orchestrator validates incoming configs against this on load — failures = project not registered, surfaced to owner.

## 1. Schema Overview

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "projectId": "string (kebab-case, matches projects.slug)",
  "name": "string (human display name)",
  "githubRepo": "string ('owner/repo' format)",
  "clickupFolderId": "string | null",
  "defaultBranch": "string",
  "branchPrefix": "string",
  "primaryBuildAgent": "claude-code",
  "qaAgent": "openai",
  "labels": { /* see section 4 */ },
  "commands": { /* see section 5 */ },
  "paths": { /* see section 6 */ },
  "trustedUsers": ["string"],
  "allowedTaskTypes": ["string"],
  "blockedTaskTypes": ["string"],
  "limits": { /* see section 8 */ },
  "deployment": { /* see section 9 */ },
  "metadata": { /* free-form, see section 10 */ }
}
```

## 2. Required vs Optional

**Required:**

- `projectId`
- `name`
- `githubRepo`
- `defaultBranch`
- `branchPrefix`
- `primaryBuildAgent`
- `qaAgent`
- `labels` (full block)
- `commands` (at minimum: install, lint, typecheck, test, build)
- `trustedUsers` (at least one entry)

**Optional:**

- `clickupFolderId`
- `paths`
- `allowedTaskTypes` (defaults to all)
- `blockedTaskTypes` (defaults to none beyond agent-policy hard blocks)
- `limits` (falls back to global defaults)
- `deployment`
- `metadata`

## 3. Top-Level Fields

| Field | Type | Notes |
|-------|------|-------|
| `projectId` | string | kebab-case, max 60 chars, unique across all projects |
| `name` | string | display name shown in dashboards |
| `githubRepo` | string | `owner/repo`, must match webhook payload |
| `clickupFolderId` | string \| null | ClickUp folder where tasks live |
| `defaultBranch` | string | usually `main` |
| `branchPrefix` | string | e.g. `feature`, `claude` — used for all agent branches |
| `primaryBuildAgent` | string | MVP only accepts `"claude-code"` |
| `qaAgent` | string | MVP only accepts `"openai"` |
| `trustedUsers` | string[] | GitHub usernames whose actions trigger automation |

## 4. `labels` Block

Maps semantic label roles to the actual label name used in the repo. Defaults follow `docs/04-github-labels.md` exactly, but projects can rename if absolutely needed.

```json
{
  "labels": {
    "ready":   "claude-ready",
    "claimed": "claude-claimed",
    "inProgress": "claude-in-progress",
    "complete": "claude-complete",
    "qa": "openai-qa",
    "approved": "openai-approved",
    "rework": "claude-rework",
    "blocked": "blocked",
    "needsOwner": "needs-nishad",
    "doNotRun": "do-not-run-agent",
    "securityReview": "security-review",
    "databaseReview": "database-review",
    "releaseReady": "release-ready"
  }
}
```

All keys required. Strongly recommended to keep the defaults to avoid confusion across projects.

## 5. `commands` Block

Commands the runner executes. Project-specific. Must be safe to run inside a clean clone.

```json
{
  "commands": {
    "install": "npm install",
    "lint": "npm run lint",
    "typecheck": "npm run typecheck",
    "test": "npm test",
    "build": "npm run build",
    "dev": "npm run dev",
    "migrate": null,
    "seed": null
  }
}
```

- `install`, `lint`, `typecheck`, `test`, `build` are **required** (use `"true"` if a project genuinely doesn't have one — but flagged in policy review).
- `dev`, `migrate`, `seed` optional.
- `migrate` and `seed` are **never** invoked by the runner against any DB the runner doesn't own. They exist for documentation, used only inside the workspace's local fixtures.

## 6. `paths` Block

```json
{
  "paths": {
    "agentPolicy": ".claudegpt/agent-policy.md",
    "claudeGuide": "CLAUDE.md",
    "tests": "tests/",
    "src": "src/",
    "protected": [".env*", "secrets/**", "infrastructure/**"]
  }
}
```

- `agentPolicy` - where the per-repo agent policy lives. Defaults to `.claudegpt/agent-policy.md`.
- `claudeGuide` - location of CLAUDE.md, defaults to repo root.
- `tests`, `src` - hints for the runner, not enforced.
- `protected` - **additive** to the global blocklist in agent policy section 3. Project can add more, never remove.

## 7. Task Type Allowlist/Blocklist

```json
{
  "allowedTaskTypes": ["feature", "bug", "refactor", "test", "docs"],
  "blockedTaskTypes": ["infra", "security", "release"]
}
```

- If `allowedTaskTypes` is present, only issues with one of those type labels can run.
- `blockedTaskTypes` always blocks (even if also in allowed — explicit deny wins).
- Either or both may be omitted; default is "all allowed, none blocked".

## 8. `limits` Block

Overrides global defaults from `docs/02-agent-policy.md` section 12.

```json
{
  "limits": {
    "maxRunMinutes": 30,
    "maxQaMinutes": 5,
    "maxTokens": 200000,
    "maxFiles": 25,
    "maxLines": 1500,
    "maxCostUsd": 5.00,
    "concurrentRuns": 1
  }
}
```

All fields optional. Missing = global default.

## 9. `deployment` Block

```json
{
  "deployment": {
    "provider": "vercel",
    "projectId": "prj_abc123",
    "previewBranches": true,
    "productionBranch": "main",
    "smokeTestUrl": "https://example.com/healthz"
  }
}
```

Used by future `vercel_deploy_check` and `release_prep` jobs. Optional.

## 10. `metadata` Block

Free-form. Use for things the orchestrator doesn't care about but other tooling might.

```json
{
  "metadata": {
    "stage": "alpha",
    "owner": "nishad",
    "notes": "Pilot project for the orchestrator."
  }
}
```

## 11. Full Example Skeleton

```json
{
  "projectId": "example-project",
  "name": "Example Project",
  "githubRepo": "nishadsukumaran/example-project",
  "clickupFolderId": null,
  "defaultBranch": "main",
  "branchPrefix": "feature",
  "primaryBuildAgent": "claude-code",
  "qaAgent": "openai",
  "trustedUsers": ["nishadsukumaran"],
  "labels": {
    "ready": "claude-ready",
    "claimed": "claude-claimed",
    "inProgress": "claude-in-progress",
    "complete": "claude-complete",
    "qa": "openai-qa",
    "approved": "openai-approved",
    "rework": "claude-rework",
    "blocked": "blocked",
    "needsOwner": "needs-nishad",
    "doNotRun": "do-not-run-agent",
    "securityReview": "security-review",
    "databaseReview": "database-review",
    "releaseReady": "release-ready"
  },
  "commands": {
    "install": "npm install",
    "lint": "npm run lint",
    "typecheck": "npm run typecheck",
    "test": "npm test",
    "build": "npm run build"
  },
  "paths": {
    "agentPolicy": ".claudegpt/agent-policy.md",
    "claudeGuide": "CLAUDE.md"
  },
  "limits": {
    "maxRunMinutes": 30,
    "maxFiles": 25,
    "maxLines": 1500
  },
  "metadata": {
    "stage": "prototype",
    "owner": "nishad"
  }
}
```

(Fill this in when you're ready to register your first real project.)

## 12. Validation Rules

The loader validates:

1. `projectId` matches `/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/`.
2. `githubRepo` matches `/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/`.
3. `defaultBranch` is non-empty, no spaces.
4. `branchPrefix` is non-empty, kebab-friendly.
5. `trustedUsers` non-empty array of strings.
6. All `labels` keys present and non-empty.
7. All required `commands` keys present and non-empty (or explicitly `"true"`).
8. `limits` numeric, positive, within global hard caps (e.g. `maxRunMinutes <= 120`).
9. No duplicate `projectId` across the registry.
10. No duplicate `githubRepo` across the registry.

Failure = config not loaded, log line, owner notification.

## 13. JSON Schema File

A formal JSON Schema document lives at `config/project-config.schema.json` (to be authored when code starts). Editors can use it for autocomplete.

## 14. Update Workflow

To change a project config:

1. Edit the file in `projects/{slug}.json`.
2. Open a PR.
3. The orchestrator runs schema validation in CI.
4. Merge.
5. Orchestrator hot-reloads configs on a 60-second interval (or on `SIGHUP`).

No live config edits via UI in MVP. Production version can add an admin endpoint.
