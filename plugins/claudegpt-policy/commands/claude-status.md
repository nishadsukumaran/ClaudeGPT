---
name: claude-status
description: Print current run state — branch, issue link, hook log, validation status.
arguments: none
---

Show the current ClaudeGPT run status.

Read context from:
- `.claudegpt/current-run.json` (written by `pre-execution` hook on every run start)
- `git status` and `git log -1` for repo state
- Latest entries from `.claudegpt/hook-log.jsonl`

Output format (markdown):

```
Run ID: <uuid>
Project: <slug>
Issue: #<n> - <title>
Branch: <branch_name>
Status: <claimed|in_progress|validation|pushed|pr_open|blocked|complete>

Last 5 hook results:
- pre-execution: pass (1.2s)
- pre-edit:      pass (0.1s)
- post-edit:     pass (3.4s)
- ...

Files changed: <n>
Lines added: <n> | Lines deleted: <n>

Validation chain:
- install:    <pass|fail|pending>
- lint:       <pass|fail|pending>
- typecheck:  <pass|fail|pending>
- test:       <pass|fail|pending>
- build:      <pass|fail|pending>
```

If `.claudegpt/current-run.json` is missing, output:

```
No active ClaudeGPT run in this workspace.
```
