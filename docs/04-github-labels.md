# GitHub Label Setup Plan

> The orchestrator's policy engine routes on labels. Every project repo registered with ClaudeGPT must have these labels installed, with these exact names and colors. Mismatches break automation silently.

## 1. Full Label List

### Agent execution lifecycle

| Name | Color | Description |
|------|-------|-------------|
| `claude-ready` | `#0E8A16` (green) | Issue is fully specified and ready for Claude Code to pick up. Trigger label. |
| `claude-claimed` | `#1D76DB` (blue) | Orchestrator has claimed this issue. A run is queued or starting. Auto-applied. |
| `claude-in-progress` | `#1D76DB` (blue) | Claude is actively working on this issue. Auto-applied. |
| `claude-complete` | `#0E8A16` (green) | Claude has finished implementation and opened a PR. Auto-applied. |
| `claude-rework` | `#FBCA04` (yellow) | OpenAI QA requested changes. Claude must update the PR. Trigger label. |

### QA lifecycle

| Name | Color | Description |
|------|-------|-------------|
| `openai-qa` | `#5319E7` (purple) | PR is in QA review. Auto-applied when PR opens. |
| `openai-approved` | `#0E8A16` (green) | OpenAI QA approved the PR. Auto-applied. |
| `openai-changes-requested` | `#D93F0B` (orange-red) | OpenAI QA rejected the PR. Auto-applied. |

### Control labels

| Name | Color | Description |
|------|-------|-------------|
| `blocked` | `#B60205` (red) | Work cannot proceed. Reason should be in a comment. |
| `needs-nishad` | `#D93F0B` (orange-red) | Owner approval required before any agent runs. |
| `do-not-run-agent` | `#000000` (black) | Hard stop. Orchestrator ignores this issue regardless of other labels. |
| `security-review` | `#B60205` (red) | Requires human security review. Triggers `needs-nishad` automatically. |
| `database-review` | `#B60205` (red) | Touches DB schema or data. Triggers `needs-nishad` automatically. |
| `release-ready` | `#0E8A16` (green) | PR is approved and ready for human merge + release. |

### Priority

| Name | Color | Description |
|------|-------|-------------|
| `priority-urgent` | `#B60205` (red) | Drop everything. Hotfix tier. |
| `priority-high` | `#D93F0B` (orange) | Current sprint, near top. |
| `priority-normal` | `#FBCA04` (yellow) | Default. Pick up in order. |
| `priority-low` | `#C5DEF5` (light blue) | Nice to have. No deadline. |

### Task type

| Name | Color | Description |
|------|-------|-------------|
| `feature` | `#A2EEEF` (cyan) | New functionality. |
| `bug` | `#D73A4A` (red) | Something is broken. |
| `refactor` | `#CFD3D7` (gray) | Internal cleanup, no behavior change. |
| `test` | `#BFD4F2` (light blue) | Tests only. |
| `docs` | `#0075CA` (blue) | Documentation only. |
| `infra` | `#5319E7` (purple) | CI, deploy, infra files. |
| `security` | `#B60205` (red) | Security-impacting change. |
| `release` | `#0E8A16` (green) | Release prep, changelog, version bump. |

## 2. Label Lifecycle (Happy Path)

```
[Issue created]
  -> Type label (feature/bug/etc.) applied manually or by template
  -> Priority label applied
  -> `claude-ready` applied when scope is locked
    -> Orchestrator adds `claude-claimed`
    -> Orchestrator adds `claude-in-progress`
    -> Claude opens PR
    -> Orchestrator removes `claude-in-progress`, adds `claude-complete`
    -> PR opens, orchestrator adds `openai-qa` to PR
      -> If pass: `openai-approved` -> `release-ready`
      -> If fail: `openai-changes-requested` + `claude-rework` -> back to in-progress
```

## 3. Label Lifecycle (Blocked Path)

```
[Issue created with `security` or `database-review`]
  -> Orchestrator auto-applies `needs-nishad`
  -> `claude-ready` is ignored until `needs-nishad` is removed by Nishad
  -> Once removed, normal happy path resumes

[Agent encounters problem mid-run]
  -> Adds `blocked` + comment
  -> If owner input needed, adds `needs-nishad`
  -> Run halted
```

## 4. Hard Stop: `do-not-run-agent`

If `do-not-run-agent` is present, the policy engine ignores every other label on the issue. Use this to manually park an issue without removing the rest of the labels.

## 5. Setup Script (Outline)

A script in `scripts/setup-labels.ts` should:

1. Read the label table from a single source (this doc, parsed, or a JSON sibling).
2. For each registered project in `projects/*.json`:
   - List existing labels via GitHub API.
   - Create labels missing from the project.
   - Update labels where color or description differs.
   - Optionally delete labels that are not in the canonical list (gated behind `--prune` flag for safety).
3. Output a per-repo diff before applying.
4. Dry-run mode by default. Requires `--apply` to actually write.

### Required token scopes

GitHub App or PAT needs `issues: write` on each target repo.

### Pseudocode

```ts
async function syncLabels(repo: string, options: { apply: boolean; prune: boolean }) {
  const desired = loadCanonicalLabels(); // from JSON
  const existing = await gh.listLabels(repo);

  const toCreate = desired.filter(d => !existing.some(e => e.name === d.name));
  const toUpdate = desired.filter(d => {
    const e = existing.find(x => x.name === d.name);
    return e && (e.color !== d.color || e.description !== d.description);
  });
  const toDelete = options.prune
    ? existing.filter(e => !desired.some(d => d.name === e.name))
    : [];

  printDiff({ toCreate, toUpdate, toDelete });

  if (!options.apply) return;

  for (const lbl of toCreate) await gh.createLabel(repo, lbl);
  for (const lbl of toUpdate) await gh.updateLabel(repo, lbl);
  for (const lbl of toDelete) await gh.deleteLabel(repo, lbl.name);
}
```

## 6. Canonical Labels JSON

Store the same list in `config/labels.json` so the script and the docs share one source. Schema:

```json
[
  {
    "name": "claude-ready",
    "color": "0E8A16",
    "description": "Issue is fully specified and ready for Claude Code to pick up.",
    "category": "execution"
  }
]
```

(Colors stored without the leading `#` because GitHub API expects raw hex.)

## 7. Drift Detection

A scheduled job (daily) should:

1. Run `syncLabels` for every registered project in dry-run mode.
2. If any diff is detected, post a summary to the `Nishad Actions & Setup Inputs` list in ClickUp.

This keeps every repo aligned without forcing manual checks.

## 8. Why These Exact Names

- `claude-ready` is the **only** trigger label for build. One word, one intent. Easier to spot in webhook payloads.
- `needs-nishad` is owner-specific by design. Generic "needs-review" is too easy to misroute.
- All agent-applied labels prefix with the agent name (`claude-*`, `openai-*`) so it's obvious in the UI who set what.
- `do-not-run-agent` is a deliberately verbose kill switch. Hard to apply by accident, easy to spot in audits.

## 9. Anti-Patterns

Do not introduce:

- `wip` - vague, overlaps with `claude-in-progress`.
- `review` - overlaps with `openai-qa`.
- `urgent` - missing the `priority-` prefix, breaks routing.
- Per-developer labels - this is single-owner; no need.
- Status labels that duplicate GitHub's built-in PR states (`open`, `closed`, `merged`).

If a new label is genuinely needed, add it to this doc, then `config/labels.json`, then run the sync. Never just add it ad-hoc in the GitHub UI.
