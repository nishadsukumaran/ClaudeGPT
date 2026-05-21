# claudegpt-policy

Reusable Claude Code plugin that enforces ClaudeGPT's agent policy at runtime inside any target repository.

## What it does

- Runs hook scripts at each lifecycle point (pre-execution, pre-edit, post-edit, pre-commit, pre-push, pre-pr, post-pr).
- Provides slash commands (`/claude-status`, `/claude-handoff`, `/claude-bail`) for the human operator.
- Ships agent presets (`builder`, `rework`) with tool allowlists already configured.
- Loads project-specific blocked paths and risk keywords from JSON policy files.

## Layout

```
claudegpt-policy/
  plugin.json
  hooks/                Each script reads JSON on stdin, exits 0 (pass) or non-zero (block)
  commands/             Markdown definitions for slash commands
  agents/               Agent presets with frontmatter (model, tools, prompt)
  policies/             Data files (paths, keywords) — extendable per project
  CHANGELOG.md
  README.md
```

## Install

Until the orchestrator's `scripts/install-plugin.ts` is built, install manually:

```bash
# From the target repo root
mkdir -p .claude/plugins
cp -R /path/to/claudegpt/plugins/claudegpt-policy .claude/plugins/

# Verify
ls .claude/plugins/claudegpt-policy/
```

Then in the target repo's `CLAUDE.md`, add:

```markdown
This repo uses the `claudegpt-policy` Claude Code plugin. Honor its hooks at every lifecycle point.
```

## Versioning

Semver. Breaking changes (new required hook, schema change in policies) bump major.

See `CHANGELOG.md` for history.

## Don't fork

If a project needs different behavior, extend the **policy data files** (`blocked-paths.json`, `risk-keywords.json`). Do not fork the plugin itself — that fragments updates across repos.
