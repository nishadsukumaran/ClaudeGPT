---
name: claude-bail
description: Emergency abort — discard all uncommitted work, drop the branch, mark issue blocked.
arguments: [required] reason
---

Emergency abort the current ClaudeGPT run.

Use only when the agent has detected:
- A blocked-paths violation that already happened (file edit attempted on a protected path)
- A risk-keyword match discovered mid-run
- An unrecoverable validation failure (e.g., test suite hangs)
- Owner has applied `do-not-run-agent` mid-run

Steps:
1. Reset all uncommitted changes: `git reset --hard HEAD`.
2. Remove any untracked files in the working tree.
3. Checkout the default branch.
4. Delete the local feature branch.
5. Comment on the parent issue:
   - "ClaudeGPT run aborted. Reason: `<reason>`. No changes pushed. No PR opened."
6. Add label `blocked` (and `needs-nishad` if reason involves risk keywords or policy violation).
7. Remove `claude-claimed` and `claude-in-progress` labels (the issue is no longer being worked).
8. Write `.claudegpt/bail.json` with run ID, reason, timestamp, file paths that were in-flight.
9. Exit Claude Code session with code 2.

Do NOT:
- Push anything to remote.
- Open a PR.
- Try to "salvage" partial work.

If you trigger this command, the orchestrator will receive the exit code 2 and mark the job as `failed`. The owner is notified.
