# ClaudeGPT - MVP PRD

**Owner:** Nishad Sukumaran
**Status:** Draft v1
**Target launch:** Phase 6 of build plan complete

## 1. Problem

AI software delivery today is manual. A founder copies prompts between ChatGPT, Claude, GitHub, and ClickUp. Issues get lost, scope creeps, agents do unsafe things, and there is no audit trail. Running multiple projects (AI Social Media OS, IdeaFlow, TradeGenie, MathAI, BASIR) with this approach does not scale.

## 2. Solution

A middleware orchestrator that turns the manual loop into an event-driven, policy-gated workflow:

```
Issue created -> Label claude-ready -> Orchestrator claims -> Claude builds -> PR opened -> OpenAI reviews -> Approved or rework -> ClickUp updates
```

GitHub stays the source of truth. ClickUp stays the dashboard. The orchestrator is the controller in between.

## 3. Goals

- **G1.** One labeled GitHub issue must be enough to trigger a full build-to-PR run with no manual prompting.
- **G2.** Every agent action must be logged with full context (prompt, files, tests, result).
- **G3.** No agent action runs without policy approval.
- **G4.** Same orchestrator must serve multiple projects via per-project config.
- **G5.** OpenAI QA must catch scope creep, missing tests, and security smells before merge.

## 4. Non-Goals (MVP)

- Auto-merge. PRs always need human merge.
- Production deployment automation.
- Full admin UI. Configs live as JSON in the repo for now.
- Two-way ClickUp sync. One-way GitHub -> ClickUp only.
- Sandbox network isolation. Trust the runner host until later.
- Multi-agent routing beyond Claude Code + OpenAI.

## 5. Users

| User | Role | What they do |
|------|------|--------------|
| Nishad | Owner | Approves high-risk tasks, sets priorities, reviews releases |
| ChatGPT / OpenAI PM | Task creator + reviewer | Writes issues, reviews PRs |
| Claude Code | Implementer | Writes the code |
| OpenAI QA | Reviewer | Approves or requests changes on PRs |
| ClaudeGPT | Controller | Routes events, enforces policy, syncs state |

## 6. User Stories

**Story 1 - As Nishad, I want to label a GitHub issue `claude-ready` and have Claude open a PR within minutes,** so that I do not have to copy prompts manually.

Acceptance: Label applied -> within 60s the orchestrator comments `Run claimed` on the issue -> within the timeout window a PR appears linked to the issue.

**Story 2 - As Nishad, I want unsafe tasks to require my approval,** so that an agent cannot touch billing, auth, or production DB without me saying yes.

Acceptance: Issue with `security`, `database-review`, or matching keyword in title/body gets `needs-nishad` and a blocked status. No job runs until I remove `needs-nishad`.

**Story 3 - As Nishad, I want OpenAI to review every Claude PR,** so that scope creep and missing tests are caught before merge.

Acceptance: Every Claude PR gets an `openai-qa` label automatically. OpenAI posts a review comment with pass/fail and a fix list within the QA timeout.

**Story 4 - As Nishad, I want one orchestrator to handle all my projects,** so that I do not need to spin up infra per product.

Acceptance: New project added by dropping a JSON config file in `projects/`. No code change needed.

**Story 5 - As Nishad, I want a full audit log of every agent run,** so that I can debug failures and prove what happened.

Acceptance: Each run has a unique ID, stored prompt snapshot, command outputs, file changes, test results, and final status. Queryable via API.

## 7. MVP Feature List

| # | Feature | Phase |
|---|---------|-------|
| F1 | GitHub webhook endpoint with signature verification | 1 |
| F2 | Project registry loaded from JSON config files | 1 |
| F3 | Event normalization and storage | 1 |
| F4 | Policy engine with label + user + risk checks | 2 |
| F5 | Task claim service with deduplication | 2 |
| F6 | BullMQ + Redis job queue | 2 |
| F7 | Claude Code runner: clone, branch, prompt, validate, push, PR | 3 |
| F8 | Run log service with structured logs | 3 |
| F9 | OpenAI QA reviewer with PR diff input | 4 |
| F10 | QA approve/rework label automation | 4 |
| F11 | ClickUp one-way status sync | 5 |
| F12 | Owner action creation on blocked tasks | 5 |
| F13 | Secret scanning before push | 6 |
| F14 | Timeout + retry handling | 6 |
| F15 | Run dashboard (read-only HTML) | 6 |

## 8. Success Criteria

- **SC1.** End-to-end run on a real issue completes within 10 minutes (excluding human review).
- **SC2.** Zero secrets committed in any run.
- **SC3.** QA pass rate above 60% on first attempt for issues that meet the format spec.
- **SC4.** Two projects running through the same orchestrator without code changes.
- **SC5.** Every run traceable from ClickUp task -> GitHub issue -> PR -> run log.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Claude commits secrets | Pre-commit secret scan + agent policy + no `.env` rule |
| Runaway cost on long runs | Per-job token + time budget, kill switch label |
| Webhook spoofing | GitHub signature verification + delivery ID dedup |
| Wrong repo executed | Project registry allowlist, repo must match config |
| QA rubber-stamps bad PRs | QA prompt anchored to issue acceptance criteria, not just "looks good" |
| Concurrent runs on same issue | Task claim service with DB lock |

## 10. Milestones

| Milestone | Definition of Done |
|-----------|-------------------|
| M1: Webhook live | Signed GitHub events stored in DB, project resolved correctly |
| M2: First Claude PR | Real issue produces real PR with passing tests |
| M3: First QA cycle | OpenAI posts a real review, rework loop works |
| M4: Multi-project | Two projects in registry, both can run jobs |
| M5: ClickUp sync | Status visible in ClickUp without manual update |
| M6: Hardened | Secret scan, timeouts, retries, dashboard, docs complete |

## 11. Open Questions

- Where does the runner execute? Vercel function (cold start risk), Railway worker, or dedicated VM?
- How are GitHub App tokens rotated?
- Do we store full PR diffs or just summaries to control DB size?
- ClickUp custom fields: build them now or rely on comments-only for MVP?
- Cost budgeting: hard limit per run, per project, or per day?

These get answered before Phase 6 starts.
