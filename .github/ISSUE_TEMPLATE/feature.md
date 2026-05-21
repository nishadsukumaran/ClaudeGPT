---
name: Feature (Claude-ready)
about: A new feature that ClaudeGPT can pick up once `claude-ready` is applied.
title: "Task NN: <Short feature title>"
labels: ["feature", "priority-normal"]
assignees: []
---

# Objective

<!-- One paragraph. What is this task trying to achieve and why does it matter? -->

# Context

<!-- Background the agent needs. Link relevant docs, prior PRs, design notes. -->

# Scope

<!-- Bullet list of exactly what is in scope. Be specific. -->
-
-
-

# Out of Scope

<!-- Bullet list of things the agent must NOT do as part of this task. -->
-
-
-

# Technical Notes

<!-- Anything technical the agent should know: file locations, conventions, libraries to use or avoid, performance constraints, etc. -->

# Acceptance Criteria

<!-- Each criterion must be testable. The agent will treat this as a checklist. -->
- [ ]
- [ ]
- [ ]

# Testing Requirements

<!-- What tests are required. Unit, integration, e2e, manual? Which scenarios? -->
-
-

# Branch Name

`feature/issue-{{number}}-<short-slug>`

# PR Requirements

- PR opens as draft
- All validation commands pass before marking ready
- PR body follows the standard format (Summary, Files Changed, Tests Run, Known Limitations, Follow-Up, Agent Notes)
- Links this issue via `Closes #{{number}}`

# Definition of Done

- [ ] All acceptance criteria satisfied
- [ ] All required tests written and passing
- [ ] `lint`, `typecheck`, `test`, `build` all pass
- [ ] No secrets or `.env` files in the diff
- [ ] PR opened with OpenAI QA approval pending
- [ ] CLAUDE.md updated if a new top-level directory or command was added
