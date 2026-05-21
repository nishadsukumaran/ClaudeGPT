# First Claude Code Task - Task 01: Project Setup

> This is the first concrete implementation task ClaudeGPT will run end-to-end. Use this when Phase 3 of the build plan is ready. Paste the content of section 5 below as a GitHub issue body once the runner is wired up.

## 1. Purpose

Prove the loop. The smallest possible task that touches every part of the system:

```
Issue created -> label claude-ready -> orchestrator claims -> Claude builds -> PR opened -> OpenAI reviews -> approved -> ClickUp synced
```

If this task succeeds, the platform works. If it fails, we know exactly where the loop broke.

## 2. Target Repository

For the pilot run, use a **fresh test repository** the orchestrator owns. Do not run the very first task against an existing product repo. Recommended:

- Repo: `nishadsukumaran/claudegpt-pilot`
- Branch: `main`
- Initial state: empty repo with just `README.md`, `LICENSE`, `.gitignore`

This gives a clean slate where Claude's output is unambiguous.

## 3. Pre-Run Checklist

Before applying `claude-ready` to the test issue, verify:

- [ ] Orchestrator is reachable and `/v1/ready` returns 200
- [ ] GitHub App installed on the pilot repo
- [ ] Webhook secret configured
- [ ] Pilot repo registered in `projects/claudegpt-pilot.json`
- [ ] All labels from `docs/04-github-labels.md` applied to the repo
- [ ] `.github/ISSUE_TEMPLATE/*` files copied to the pilot repo
- [ ] `CLAUDE.md` placed in the pilot repo root (use the template from `docs/03-claude-md-template.md`)
- [ ] `.claudegpt/agent-policy.md` placed in the pilot repo
- [ ] Trusted users list includes the account that will apply the label
- [ ] Anthropic + OpenAI API keys configured
- [ ] At least one test run of the runner CLI against this repo (without webhook trigger) has succeeded locally

## 4. Success Criteria for the Loop

The task itself is "set up the project scaffold." The criteria for the **loop** are:

- [ ] Webhook received within 5 seconds of label apply
- [ ] `claude-claimed` label appears on the issue within 30 seconds
- [ ] Comment posted on the issue with Run ID, branch name, and "queued" status
- [ ] Branch `feature/issue-1-project-setup` created
- [ ] PR opens within 10 minutes (allowing for Claude's wall-clock)
- [ ] PR body follows the standard format
- [ ] All validation commands pass before PR is marked ready
- [ ] `openai-qa` label applied automatically to PR
- [ ] OpenAI QA posts a review comment with structured pass/fail JSON
- [ ] If pass: `openai-approved` label applied; if fail: `claude-rework` applied
- [ ] Run log queryable via `/v1/runs/:runId` with full step history
- [ ] No secrets in the diff
- [ ] No deviation from scope

## 5. Issue Body (Copy-paste into GitHub)

```markdown
# Objective

Set up the initial project scaffold for the ClaudeGPT pilot repository so future tasks have a working baseline.

# Context

This is the first task that runs end-to-end through ClaudeGPT. The repository is currently empty except for README, LICENSE, and .gitignore. We need a minimal but functional TypeScript Node project that future tasks can build on.

# Scope

- Initialize a TypeScript Node project with `npm init` and `tsconfig.json`
- Add ESLint + Prettier with reasonable defaults
- Add a `src/` directory with a single `index.ts` exporting a `hello()` function that returns the string "ClaudeGPT pilot online"
- Add Vitest as the test runner
- Add one passing test for `hello()` in `tests/hello.test.ts`
- Add npm scripts: `lint`, `typecheck`, `test`, `build`
- Add `.gitignore` entries for `node_modules`, `dist`, and `.env*`
- Add a minimal `CONTRIBUTING.md` describing how to run the project locally
- Update the existing `README.md` with a "Getting started" section

# Out of Scope

- No CI workflow (will be a separate task)
- No Docker, no deployment config
- No additional dependencies beyond what's listed above
- No source code beyond `hello()` — do not invent additional modules
- No database, no API, no UI
- No license change

# Technical Notes

- Node version target: 20.x (set `"engines"` in `package.json`)
- TypeScript strict mode on
- ESM modules (`"type": "module"` in package.json)
- ESLint config should extend `eslint:recommended` and `@typescript-eslint/recommended`
- Prettier defaults are fine
- All scripts must exit 0 on a fresh clone after `npm install`

# Acceptance Criteria

- [ ] `npm install` succeeds on a fresh clone
- [ ] `npm run lint` passes with no warnings
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes with at least one test green
- [ ] `npm run build` produces output in `dist/`
- [ ] `src/index.ts` exports a `hello()` function
- [ ] `tests/hello.test.ts` tests that `hello()` returns "ClaudeGPT pilot online"
- [ ] `.gitignore` covers node_modules, dist, .env*
- [ ] `CONTRIBUTING.md` exists with at least 3 sections (Setup, Running locally, Submitting changes)
- [ ] `README.md` updated with Getting Started section
- [ ] No secret values or `.env` files in the diff

# Testing Requirements

- Unit test for `hello()`
- Manual verification: cloning the branch and running `npm install && npm run lint && npm run typecheck && npm test && npm run build` succeeds end-to-end

# Branch Name

`feature/issue-1-project-setup`

# PR Requirements

- PR opens as draft
- PR title: `[1] Project Setup`
- PR body follows standard format
- Links this issue via `Closes #1`
- All validation commands pass before marking ready

# Definition of Done

- [ ] All acceptance criteria satisfied
- [ ] All required tests passing
- [ ] `lint`, `typecheck`, `test`, `build` all pass
- [ ] No secrets in the diff
- [ ] PR opened, marked ready, OpenAI QA approval pending
- [ ] CLAUDE.md unchanged (no new top-level dirs beyond src and tests, both already mentioned)
```

## 6. Expected Diff Size

Roughly:

| File | Lines |
|------|-------|
| `package.json` | ~40 |
| `tsconfig.json` | ~25 |
| `.eslintrc.json` | ~15 |
| `.prettierrc` | ~5 |
| `src/index.ts` | ~5 |
| `tests/hello.test.ts` | ~8 |
| `.gitignore` (updates) | ~5 |
| `CONTRIBUTING.md` | ~30 |
| `README.md` (updates) | ~15 |
| `vitest.config.ts` | ~10 |

Total: ~160 lines across 10 files. Well within `maxFiles` and `maxLines` limits.

## 7. Expected Run Timeline

| Step | Expected duration |
|------|-------------------|
| Webhook -> claim | < 5s |
| Workspace setup + clone | < 30s |
| Claude execution | 2-5 min |
| Validation (install + lint + typecheck + test + build) | 1-2 min |
| Commit + push + PR | < 30s |
| OpenAI QA | 30-90s |
| Total | 5-10 min |

## 8. Failure Modes to Watch

| Failure | Likely cause | Action |
|---------|--------------|--------|
| Webhook never arrives | Bad webhook secret, wrong URL | Check GitHub webhook delivery panel |
| Claim works but no PR | Runner crashed mid-execution | Check `run_logs` for the run ID |
| PR opened but lint fails | Claude wrote code that violates ESLint | Read PR review, may need stricter prompt |
| QA fails on first try | Acceptance criteria too vague | Tighten the issue body, re-run |
| QA passes but tests fail | Tests not actually run before push | Check `pre-pr` hook firing |
| `.env` in diff | Secret scan missed it | Verify gitleaks (or chosen scanner) is in the pre-commit hook chain |
| Workspace not cleaned up | Cleanup hook crashed | Manually delete, fix the hook |

## 9. After This Task Succeeds

Once Task 01 completes the full loop end-to-end:

1. Run Task 02 (TBD) that introduces a slightly more complex change (e.g. add a second function, add a CLI entry point).
2. Run Task 03 with a deliberate scope violation in the issue body to verify the policy engine catches it.
3. Run Task 04 that hits the `claude-rework` path (QA requests changes, Claude updates the PR).
4. Run Task 05 with `database-review` label to verify the `needs-nishad` gating works.

Only after these five tasks all behave correctly should the orchestrator be pointed at a real product repo (AI Social Media OS or another pilot project).

## 10. Rollback Plan

If Task 01 fails catastrophically (e.g. runner force-pushes to main, secret committed, infinite loop in agent):

1. Disable the GitHub App on the pilot repo.
2. Pause the orchestrator's worker process.
3. If a secret was committed: rotate it immediately, then `git filter-branch` or repo nuke.
4. Open an incident note in `docs/incidents/` describing what happened, what the policy missed, and what to add to `02-agent-policy.md`.

The pilot repo being a separate test repo means a catastrophic failure here cannot damage any product.
