# Setup Runbook — CLI Auth and GitHub App Install

> One-time setup on the runner host so ClaudeGPT can build PRs using your Claude Max subscription, and so the ChatGPT GitHub App can post QA reviews on every PR.

## Architecture recap

- **Builder** (`claude-builder`, `claude-rework`): the orchestrator's worker spawns the `claude` CLI as a subprocess. Auth is OAuth against Claude Max — no API key.
- **Reviewer** (`openai-reviewer`): **the orchestrator does not invoke ChatGPT.** The ChatGPT GitHub App is installed separately on each project repo. When the builder opens a PR, the App auto-reviews and posts a comment as the ChatGPT bot account. ClaudeGPT listens for that comment via webhook, parses the prose into a structured verdict via Claude, and applies labels.

## Prerequisites

- Node 20+ on the runner host
- Internet access to claude.ai from the host
- Persistent disk for `$HOME/.claude/` (matters on ephemeral container hosts — see Common Issues)
- Access to install GitHub Apps on the target org/repos

## Part A — Claude Code CLI (builder)

### A1. Install

```bash
# macOS / Linux
curl -fsSL https://claude.ai/install.sh | bash

# Or via npm (works everywhere)
npm install -g @anthropic-ai/claude-code

# Verify
claude --version
```

### A2. Login

```bash
claude login
```

CLI prints a URL. Open it in your browser, sign in to Claude Max, authorize. Credentials persist to `~/.claude/credentials.json` (or platform equivalent).

Verify:

```bash
echo "reply with the word PONG" | claude --print
# Should return text containing PONG
```

### A3. Test the subprocess contract

```bash
cd path/to/ClaudeGPT
node -e "
const { spawn } = require('node:child_process');
const child = spawn(process.env.CLAUDE_CLI_PATH || 'claude', ['--print', '--output-format=json', '--model=claude-sonnet-4-6']);
child.stdout.on('data', d => process.stdout.write(d));
child.stderr.on('data', d => process.stderr.write(d));
child.on('close', c => console.log('\\nexit:', c));
child.stdin.write('reply with the word PONG');
child.stdin.end();
"
```

Expected: JSON-wrapped response containing PONG. If your installed CLI uses different flags, patch `packages/runner/src/claude.ts`.

## Part B — ChatGPT GitHub App (reviewer)

### B1. Install the App

1. Go to https://github.com/apps/chatgpt (or whatever the current install URL is for OpenAI's official ChatGPT GitHub App).
2. Click "Install".
3. Choose the target organization or your personal account.
4. Select **"Only select repositories"** and pick your ClaudeGPT pilot repo (and any other project repos you want auto-reviewed).
5. Confirm the permissions the App requests: Pull Requests (read & write), Issues (read & write), Contents (read).

### B2. Configure auto-review

Inside the ChatGPT GitHub App settings (or via the ChatGPT app preferences):

1. Enable **"Auto-review pull requests"** for the installed repos.
2. (Optional) Configure the review's system prompt to ask for explicit `VERDICT: pass` or `VERDICT: fail` at the end — helps the Claude parser disambiguate edge cases. But not required; the parser handles prose.

### B3. Identify the bot account

After install, find the App's bot account login (used in webhook payloads as `sender.login`):

```bash
# Open any PR on a repo where the App is installed.
# Wait for the auto-review comment to appear.
# Check the comment's author username.
# Common patterns: chatgpt[bot], openai-codex[bot], gh-chatgpt[bot]
```

If it's one of the defaults already in `packages/qa/src/botFilter.ts`, no config needed. If it's something else, set in `.env`:

```
CHATGPT_BOT_LOGIN=actual-bot-username[bot]
```

(Comma-separate multiple values if you have several App installs with different bot logins.)

### B4. Verify the listener fires

1. Create a test PR in the pilot repo (manual, not via ClaudeGPT yet).
2. Wait for ChatGPT's review comment to land.
3. Check the orchestrator logs:
   - Should see `webhooks.github` log line for `issue_comment.created` or `pull_request_review.submitted`.
   - Should see `routing.router` log line: `Event routed and job enqueued`, jobType `openai_qa_review`, mode `inbound`.
   - Should see `qa.inbound` log line: `Processing inbound ChatGPT review`.
   - Eventually `qa.parse.claude` → verdict logged.
   - Labels applied to PR: `openai-approved` or `openai-changes-requested` + `claude-rework`.

## Part C — Verify ClaudeGPT can find the CLI

```bash
which claude
# Should print an absolute path on the host PATH.
```

If `claude` is at a non-standard path, set in `.env`:

```
CLAUDE_CLI_PATH=/absolute/path/to/claude
```

## Common issues

**`claude: command not found` after install**
Installer likely put the binary in `~/.local/bin/`. Add to PATH or set `CLAUDE_CLI_PATH`.

**`Not logged in` errors mid-run**
The CLI session expired or `$HOME` differs between login shell and runner process. Re-run `claude login` as the same user/host that runs the worker.

**Ephemeral container hosts (Fly, Railway, etc.)**
`~/.claude/` does NOT persist across container restarts by default. Two options:
1. Mount a persistent volume at `/root/.claude/`
2. (Less safe) Bake the credentials into the container image — secrets in image layers, only do this if the image registry is private and access-controlled

**ChatGPT review takes longer than 30 minutes**
The default QA timeout is 30 minutes. After that, the timeout watcher applies `blocked` + `needs-nishad`. You can manually remove the labels and wait for the review, or raise the timeout in `packages/routing/src/router.ts` (`QA_TIMEOUT_DELAY_MS`).

**ChatGPT review doesn't fire at all**
1. Check the App is installed on the right repo.
2. Check auto-review is enabled.
3. Check the App has Pull Request and Contents permissions.
4. Check your ChatGPT Pro subscription has Codex / GitHub integration entitlements active.
5. As a fallback, comment `@chatgpt review this PR please` on the PR — manual trigger.

**Review parsed wrong (false pass / false fail)**
The Claude parser is conservative — when in doubt, fail. If you see false passes (ChatGPT raised concerns but parser said pass), tighten the parser prompt in `packages/qa/src/claudeParser.ts` to require unambiguous "LGTM" signals.

**Wrong bot login filter**
If the listener doesn't fire even though ChatGPT clearly commented, the bot's `sender.login` probably doesn't match the allowlist. Pull a recent webhook payload from `github_events` table:

```sql
SELECT sender, repo, event_type, created_at
FROM github_events
WHERE event_type = 'issue_comment'
ORDER BY created_at DESC
LIMIT 5;
```

Add the actual bot login to `CHATGPT_BOT_LOGIN` env var.

**Concurrent claude CLI runs**
Some CLI versions have issues with multiple parallel sessions writing to the same credential store. If you see auth-flapping, set `RUNNER_MAX_CONCURRENT=1`.

## API key fallback

If subscription auth is impractical (locked-down CI runner with no persistent storage):

```
# In .env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

Note: only `ANTHROPIC_API_KEY` actually affects builder fallback today. The reviewer is exclusively listener-mode — there is no API-key path for it. If the ChatGPT GitHub App doesn't fit your needs, the route is to bring back a Codex CLI or OpenAI API caller (the original implementation is in git history).

## Agents table sanity check

After setup, your seeded agents should look like:

```
name              provider     auth         mode       model
claude-builder    anthropic    claude-cli   null       claude-sonnet-4-6
claude-rework     anthropic    claude-cli   null       claude-sonnet-4-6
openai-reviewer   openai       github-app   listener   chatgpt-github-app
clickup-sync      internal     null         null       null
release-prep      openai       github-app   null       (disabled)
```

Query:

```sql
SELECT name, provider, status, config_json->>'auth' AS auth, config_json->>'mode' AS mode, config_json->>'model' AS model
FROM agents
ORDER BY name;
```
