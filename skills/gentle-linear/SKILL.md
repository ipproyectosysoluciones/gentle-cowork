---
name: gentle-linear
description: "Use Linear for project tracking following gentle-ai contracts: create issues with conventional commit references, ODD-compliant descriptions, and spec-by-reverse links. Update statuses with evidence."
---

# gentle-linear — Linear Issue Management

Use this skill when creating, updating, or managing issues in Linear for any gentle ecosystem project.

## Issue Creation Rules

Every Linear issue MUST include:

1. **Title**: Conventional format — `[Project] Action: description`
   - Example: `[gentle-cowork] feat: add verifier role with per-S# verdicts`
2. **Description** MUST contain:
   - **What**: Clear objective
   - **Why**: The named delegation reason or user request
   - **Spec reference**: Path to the ODD feature document (if applicable)
   - **Evidence**: What proves completion (tests, commits, files)
3. **Priority**: Based on real urgency, not perceived importance

## Issue Update Rules

When updating an issue status:
- `In Progress` → MUST include what is being worked on and current branch
- `Done` → MUST include evidence (commit hash, test results, files modified)
- Never close without evidence — "it works" is not evidence

## Status Flow

```
Backlog → Todo → In Progress → Done
```

- `Backlog`: Discovered but not yet prioritized
- `Todo`: Prioritized, ready to start
- `In Progress`: Actively being worked on (MUST reference branch)
- `Done`: Completed with evidence

## Labels Convention

Use labels to categorize:
- `phase-N` — Roadmap phase (gentle-cowork)
- `bug` — Something broken
- `feature` — New capability
- `enhancement` — Improvement to existing
- `upstream` — Related to gentle-dot upstream issues
- `documentation` — Docs only

## Integration with gentle-ai Contracts

| gentle-ai Contract | Linear Application |
|---|---|
| Conventional Commits | Issue titles follow conventional format; commits referenced in evidence |
| Spec by reference | Issue descriptions link to ODD feature docs, never paraphrase |
| ODD compliance | Issues track delegated work; small understood work doesn't need an issue |
| Review authority | Linear never replaces gentle-ai review; it TRACKS the outcome |

## Anti-patterns (never do)

- Create issues without clear acceptance criteria
- Close issues without evidence (commit hash or test output)
- Use Linear as a mirror of GitHub Issues (they serve different purposes)
- Create issues for small understood work that ODD handles inline
- Paraphrase specs in issue descriptions — link to the source document
