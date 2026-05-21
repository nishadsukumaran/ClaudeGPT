# ClaudeGPT Hooks

Executable hook scripts that intercept agent lifecycle events. Each hook reads a JSON payload on stdin, runs its check, and exits 0 (continue) or non-zero (block).

These scripts are the **source of truth** for hook behavior. The plugin (`plugins/claudegpt-policy/hooks/`) ships copies into target repos when installed.

## Hook inventory

| File | When it fires | Exit codes |
|------|---------------|------------|
| `pre-execution.js` | Before Claude is invoked | 0 = pass, 1 = block, 2 = needs-nishad |
| `pre-edit.js` | Before each edit batch | 0 = pass, 1 = block |
| `post-edit.js` | After each edit batch | 0 = pass, 1 = warn, 2 = block |
| `pre-commit.js` | Before git commit | 0 = pass, 1 = block |
| `pre-push.js` | Before git push | 0 = pass, 1 = block |
| `pre-pr.js` | Before opening PR | 0 = pass, 1 = block |
| `post-pr.js` | After PR opens | 0 = pass (informational) |

## stdin contract

Every hook receives JSON on stdin:

```json
{
  "hook": "pre-commit",
  "run_id": "uuid",
  "project_id": "uuid",
  "repo": "owner/repo",
  "branch": "feature/issue-12-project-setup",
  "issue_number": 12,
  "files_changed": ["src/index.ts"],
  "diff_stats": { "files": 1, "additions": 18, "deletions": 0 },
  "workspace_path": "/abs/path/to/runner/workspace"
}
```

## stdout contract (block)

```json
{
  "block": true,
  "reason": "Detected potential secret in src/config.ts:42",
  "suggested_label": "blocked",
  "needs_owner": false
}
```

## stdout contract (pass with warnings)

```json
{
  "block": false,
  "warnings": ["lint emitted 2 warnings in src/utils.ts"]
}
```

## Implementation notes

- All hooks are Node 20+ JavaScript (no TypeScript at hook layer — keep deps zero).
- Hooks must not depend on `node_modules` from the repo being processed. Use Node stdlib only.
- Hook timeout = 30s. Slower than that = orchestrator treats as a block.
- Hooks must be idempotent — the orchestrator may invoke them multiple times in a single run.
- Hooks write structured logs to `.claudegpt/hook-log.jsonl` for the `/claude-status` slash command.

## Testing hooks locally

```bash
echo '{"hook":"pre-commit","repo":"test/repo","files_changed":[".env"]}' | node hooks/pre-commit.js
echo "exit code: $?"
```

Expected: exit 1, JSON block on stdout naming `.env`.
