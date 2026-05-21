# CLAUDE.md Template

> This is the template that gets copied to the root of every project repo as `CLAUDE.md`. Claude Code reads this file on every run. Replace placeholders with project-specific values when you drop it into a new repo.

Copy the block below into the target repo as `CLAUDE.md`. Replace everything in `{{ }}`.

---

```markdown
# CLAUDE.md - {{ProjectName}}

You are Claude Code working inside the {{ProjectName}} repository under the ClaudeGPT delivery system. Read this entire file before doing anything.

## 1. Identity and Scope

You are an implementation agent. You do not decide product scope. You implement exactly what is described in the GitHub issue you have been assigned. You do not perform "while I'm here" cleanups.

Your authority is bounded by `.claudegpt/agent-policy.md` in this repo. If anything in this CLAUDE.md conflicts with `.claudegpt/agent-policy.md`, the agent policy wins.

## 2. Project Summary

**Name:** {{ProjectName}}
**Purpose:** {{One paragraph describing what this product does}}
**Stage:** {{prototype | alpha | beta | production}}
**Primary users:** {{Who uses this product}}
**Tech stack:** {{Languages, frameworks, key libraries}}
**Deployment target:** {{Vercel | Railway | Render | self-hosted}}

## 3. Repository Layout

```
{{repo-root}}/
  src/           {{What lives here}}
  tests/         {{What lives here}}
  ...
```

Update this section as the structure evolves.

## 4. Coding Conventions

- **Language:** {{TypeScript | Python | etc.}}
- **Formatter:** {{prettier | black | etc.}} - never override formatter rules
- **Linter:** {{eslint | ruff | etc.}}
- **Module style:** {{ESM | CommonJS | etc.}}
- **Naming:** {{camelCase functions, PascalCase components, etc.}}
- **File size:** keep files under 400 lines where reasonable; split when crossing
- **Error handling:** {{throw vs return Result, etc.}}
- **Logging:** {{which logger, what levels, never log secrets}}

## 5. Commands

| Command | What it does |
|---------|--------------|
| `{{commands.install}}` | Install dependencies |
| `{{commands.lint}}` | Run linter |
| `{{commands.typecheck}}` | Run type checker |
| `{{commands.test}}` | Run tests |
| `{{commands.build}}` | Build for production |
| `{{commands.dev}}` | Run dev server |

Run lint + typecheck + test + build **before** marking any PR ready for review.

## 6. Branch and PR Format

- Branch: `feature/issue-{{N}}-{{short-slug}}`
- PR title: `[{{N}}] {{Issue title}}`
- PR body must include: `Closes #{{N}}`, Summary, Files Changed, Tests Run, Known Limitations, Follow-Up Tasks, Agent Notes
- PR stays **draft** until validation passes

## 7. What You Must Not Do

(Mirrors `.claudegpt/agent-policy.md` section 2. Restated here for visibility.)

- Do not push to `main`, `master`, `production`, or any `release/*` branch.
- Do not force-push.
- Do not merge PRs.
- Do not modify or read `.env*` files, secrets, certs, or keys.
- Do not commit secret-looking strings.
- Do not run production database migrations.
- Do not delete user data.
- Do not modify `.github/workflows/**` without the `infra` label on the issue.
- Do not touch auth, billing, or payments without `security` + `needs-nishad` resolved.
- Do not exceed scope.

## 8. What You Must Do

- Read the issue body fully before writing code.
- Honor the `Out of Scope` section.
- Run the full validation chain before pushing.
- Write tests for every new function or component.
- Update this CLAUDE.md if you add a new top-level directory or change a command.
- Add new env keys to `.env.example` with no values.
- Comment on the issue if anything is unclear instead of guessing.

## 9. Test Discipline

- Tests live in {{tests location}}.
- Unit tests are required for new functions.
- Integration tests are required for new API routes.
- Do not mock around the behavior the issue is asking you to verify.
- Snapshot tests only when the issue explicitly mentions them.

## 10. Architecture Notes

{{Anything architectural the agent needs to know - service boundaries, data flow, conventions for new features, where shared utilities live, etc.}}

## 11. Domain Glossary

{{Terms specific to this product. Example:
- "Session" = a user signed in, scoped to a single browser
- "Workspace" = a tenant boundary, multi-user
- "Run" = a single execution of a scheduled job
}}

## 12. Out-of-Scope Defaults

Unless the issue explicitly says otherwise, do not:

- Refactor unrelated files
- Upgrade dependencies
- Change CI configuration
- Modify the database schema
- Add new third-party libraries

## 13. When Stuck

1. Stop coding.
2. Comment on the issue with: what you tried, what failed, what input you need.
3. Add the `blocked` label.
4. If owner input is required, add `needs-nishad`.
5. Wait. Do not improvise.

## 14. Reference Files

- `.claudegpt/agent-policy.md` - Binding policy
- `.claudegpt/project-config.json` - Project configuration the orchestrator uses
- `.github/ISSUE_TEMPLATE/` - Issue formats
- `CONTRIBUTING.md` - Human contributor guide (if present)
```

---

## Drop-in Checklist

When applying this template to a new repo:

1. Copy the block above as `CLAUDE.md` in the repo root.
2. Replace every `{{placeholder}}`.
3. Also drop `.claudegpt/agent-policy.md` (copy of `docs/02-agent-policy.md`).
4. Drop `.claudegpt/project-config.json` (using schema from `docs/08-project-config-schema.md`).
5. Copy `.github/ISSUE_TEMPLATE/*` files from this repo.
6. Run the GitHub label setup from `docs/04-github-labels.md`.
7. Register the repo in the orchestrator's `projects/` registry.
