---
name: Bug (Claude-ready)
about: A defect that ClaudeGPT can fix once `claude-ready` is applied.
title: "Bug: <Short description>"
labels: ["bug", "priority-high"]
assignees: []
---

# Objective

<!-- What is broken, and what should the correct behavior be? -->

# Reproduction Steps

<!-- Exact steps. Include environment details if relevant. -->
1.
2.
3.

# Expected Behavior

<!-- What should happen. -->

# Actual Behavior

<!-- What actually happens. Include error messages, stack traces, screenshots. -->

# Context

<!-- When did this start? Any recent changes? Linked PRs or commits? -->

# Scope

<!-- Bullet list of what the agent should fix. -->
-
-

# Out of Scope

<!-- Things the agent must NOT also fix or refactor. -->
-
-

# Technical Notes

<!-- Where the bug likely lives, related code paths, known constraints. -->

# Acceptance Criteria

- [ ] Bug no longer reproduces with the steps above
- [ ] Regression test added that would catch this bug in future
- [ ]

# Testing Requirements

- Regression test in `<test file path>`
- Manual verification with the reproduction steps above

# Branch Name

`fix/issue-{{number}}-<short-slug>`

# PR Requirements

- PR opens as draft
- All validation commands pass before marking ready
- PR body explains the root cause, not just the symptom fix
- Links this issue via `Closes #{{number}}`

# Definition of Done

- [ ] Reproduction no longer triggers the bug
- [ ] Regression test exists and is in the failing-before / passing-after state
- [ ] `lint`, `typecheck`, `test`, `build` all pass
- [ ] No unrelated changes in the diff
- [ ] PR opened with OpenAI QA approval pending
