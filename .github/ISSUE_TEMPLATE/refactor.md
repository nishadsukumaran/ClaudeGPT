---
name: Refactor (Claude-ready)
about: Internal restructuring with no behavior change.
title: "Refactor: <Short description>"
labels: ["refactor", "priority-low"]
assignees: []
---

# Objective

<!-- What internal improvement does this refactor achieve? Why now? -->

# Context

<!-- Why this code is painful today. Link example PRs where it caused friction. -->

# Scope

<!-- Exact files/directories/functions in scope. -->
-
-

# Out of Scope

<!-- Reminder: refactor must not change behavior. List anything the agent might be tempted to change. -->
-
-
-

# Technical Notes

<!-- New structure, naming, patterns. Reference docs or examples if helpful. -->

# Acceptance Criteria

- [ ] No behavior change observable to users or downstream code
- [ ] All existing tests pass without modification
- [ ]
- [ ]

# Testing Requirements

- All existing tests continue to pass
- No new tests required (refactor only) unless the structural change exposes a code path that previously had no coverage

# Branch Name

`refactor/issue-{{number}}-<short-slug>`

# PR Requirements

- PR opens as draft
- All validation commands pass before marking ready
- PR body explicitly states "no behavior change" and explains how this was verified
- Links this issue via `Closes #{{number}}`

# Definition of Done

- [ ] Code refactored per scope
- [ ] Existing test suite passes unmodified
- [ ] `lint`, `typecheck`, `test`, `build` all pass
- [ ] No public API or behavior change
- [ ] PR opened with OpenAI QA approval pending
