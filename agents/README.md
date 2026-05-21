# ClaudeGPT Agent Definitions

This directory contains the canonical agent definitions for ClaudeGPT. Each agent is a single markdown file with frontmatter describing its provider, model, role, triggers, tool allowlist, and limits, followed by its system prompt.

These definitions are the **source of truth**. The orchestrator loads them at runtime. The plugin (`plugins/claudegpt-policy/agents/`) ships a subset of these (builder, rework) into target repos for Claude Code agent presets.

## Agents

| File | Agent | Provider | Role |
|------|-------|----------|------|
| `builder.md` | `claude-builder` | Anthropic | Implements GitHub issues into PRs |
| `reviewer.md` | `openai-reviewer` | OpenAI | QA reviews Claude PRs |
| `rework.md` | `claude-rework` | Anthropic | Applies QA feedback to existing PR |
| `sync.md` | `clickup-sync` | Internal (no LLM) | Mirrors GitHub state to ClickUp |
| `release.md` | `release-prep` | OpenAI | Generates release notes and tags (future) |

## Conventions

- Frontmatter is YAML. Required keys: `name`, `provider`, `role`, `triggers`, `tool_allowlist`.
- Optional keys: `model`, `max_tokens_per_run`, `max_minutes_per_run`, `temperature`.
- The body after the frontmatter is the agent's system prompt.
- Tool allowlist uses dotted scope syntax: `bash:install,lint,test` means "bash, but only these commands".
- Triggers use dotted event syntax: `issue.labeled.claude-ready`.

## Why separate files

One file per agent makes it cheap to:
- Diff prompts in PRs
- Version agents independently
- Disable an agent (move to `agents/disabled/`)
- Add a new agent without touching the others

## Updating an agent

1. Edit the agent's `.md` file.
2. Add an entry to `agents/CHANGELOG.md`.
3. PR through normal process.
4. On merge, orchestrator hot-reloads agent definitions.
