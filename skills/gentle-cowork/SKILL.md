---
name: gentle-cowork
description: "Use gentle-cowork orchestration when ODD approved delegation with a named reason: route through cowork-planner (read-only decompose), cowork-implementer (scoped write), and cowork-verifier (per-S# verdict). Pass the ODD spec by reference. Never delegate by size."
---

# gentle-cowork Orchestration

Use this skill when ODD has already determined that a delegation has a valid named reason (real parallelism, independent verification, context backstop). Never delegate because a task "looks big".

## The Three Roles

| Role | Access | Responsibility |
|---|---|---|
| cowork-planner | read-only | Decompose objective → plan with steps, scope, criteria |
| cowork-implementer | scoped write | Execute ONE step → artifact summary |
| cowork-verifier | read + tests | Validate per S# requirement → APPROVE/CHANGES verdict |

## Workflow

1. **ODD classifies** the work (you do this before invoking this skill)
2. **Planner** receives the objective, reads the spec by reference, returns a plan
3. **Implementer** receives one step + specRef, executes, returns an artifact
4. **Verifier** receives the artifact + specRef, runs tests, gives per-S# verdict
5. **If CHANGES** → loop back to implementer (max 3 retries)

## Rules

- Pass the ODD spec BY REFERENCE (`specRef` path to `odd/tasks/<feature>.md`) — never paraphrase.
- Task contracts are lightweight: `{ id, objective, role, scope, acceptanceCriteria, specRef, artifacts, status }` — NOT SDD artifacts.
- Flat delegation tree: subagents never spawn sub-subagents.
- Delegation triggers: real parallelism, independent verification, or context backstop — never task size.
- The assistant's actions still go through the user's approvals — the channel adds no new authority.
- Do NOT create formal SDD artifacts (proposal, spec, design). Only lightweight task contracts.

## When NOT to Use

- Small, understood work → handle inline (ODD default)
- No named delegation reason → handle inline
- Single-file changes → handle inline
- Uncertain objectives → ask the user first, then classify
