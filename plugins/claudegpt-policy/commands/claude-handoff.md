---
name: claude-handoff
description: Cleanly hand off the current run to a human operator. Preserves work, exits the agent.
arguments: [optional] handoff_note
---

Hand off the current ClaudeGPT run.

Steps:
1. Stage any uncommitted changes (`git add -A`).
2. Create a WIP commit with message: `wip: ClaudeGPT handoff to human — <handoff_note or "no note">`.
3. Push the branch to remote.
4. Comment on the parent issue:
   - "ClaudeGPT run handed off to human operator. Branch `<branch>` pushed with WIP commit. Note: <handoff_note>"
5. Add labels `blocked` and `needs-nishad` to the issue.
6. Write `.claudegpt/handoff.json` with run ID, branch, and timestamp.
7. Exit Claude Code session.

Do NOT:
- Open a PR (the work is not validated).
- Mark the run as `complete`.
- Remove the `claude-claimed` label (it stays so future runs don't overlap).

This command is for cases where the agent recognizes it cannot finish — e.g., the issue scope is ambiguous, an external system is down, or the owner has signaled to take over.
