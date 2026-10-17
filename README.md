# gentle-cowork

An orchestration extension for [Pi](https://pi.dev) / gentle-shell that turns ODD-approved delegation into a structured, verified, multi-role workflow — without ever becoming a silent SDD.

[![TypeScript](https://img.shields.io/badge/TypeScript-strict,%20no%20any-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24%20ESM-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Pi](https://img.shields.io/badge/Pi-1.2.0%20extension-8A72FF?style=flat-square)](https://pi.dev)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-FE5196?style=flat-square&logo=conventionalcommits&logoColor=white)](https://conventionalcommits.org)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-contracts%20%2B%20release--please-2088FF?style=flat-square&logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![Linear](https://img.shields.io/badge/Linear-issue%20tracking-5E6AD2?style=flat-square&logo=linear&logoColor=white)](https://linear.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

## Mental Map

```mermaid
mindmap
  root((gentle-cowork))
    Roles
      🧠 cowork-planner
        read-only
        decompose + plan
      🔨 cowork-implementer
        scoped write
        execute one step
      ✅ cowork-verifier
        read + tests
        verdict per S#
    Workflow
      ODD classifies
      Delegate by named reason
      Plan → Implement → Verify
      APPROVE or CHANGES
    Contracts
      TaskContract
        id · objective · role
        scope · criteria · specRef
      Spec by reference
        odd/tasks/<feature>.md
    Principles
      Never by size
      Flat tree
      Invisible to ODD
      No SDD artifacts
```

## What it does

`gentle-cowork` adds three specialized subagent roles on top of gentle-shell's existing delegation mechanism:

| Role | Permission | Responsibility |
|---|---|---|
| `cowork-planner` | read-only | Decompose the objective into a plan with scope and acceptance criteria |
| `cowork-implementer` | scoped write | Execute one plan step; produces an artifact summary |
| `cowork-verifier` | read + tests | Validate changes per ODD spec requirement (S#); emit `APPROVE` or `CHANGES` verdict |

**The intelligence stays agent-side.** The bridge/extension only routes — every menu action or delegation sends a pre-crafted prompt to the assistant, which uses its native tools.

## Design principles (from the paper)

1. **Delegate by named reason, never by size.** Activated when ODD already determined that delegation has a valid reason (real parallelism, independent verification, context backstop) — never because a task "looks big".
2. **Pass the spec by reference.** Subagents receive the path to the ODD feature document, never a paraphrased summary (per gentle-shell PR #1718).
3. **Lightweight task contract, not SDD artifacts.** Each delegation carries a `TaskContract` (`{ id, objective, role, scope, acceptanceCriteria, specRef, artifacts, status }`) — no formal proposal/spec/design documents.
4. **Flat delegation tree.** Subagents never spawn sub-subagents.
5. **Invisible to ODD.** The user describes what they need; the extension routes naturally. No `/cowork` invocation required for normal flows.

## Architecture

```
Pi / gentle-shell (ODD orchestrator)
  └── gentle-cowork extension (this repo)
        ├── tool_call hook — detects delegation triggers
        ├── TaskContract — lightweight orchestration data
        └── subagent spawn (pi --mode rpc)
              ├── cowork-planner (read)
              ├── cowork-implementer (scoped write)
              └── cowork-verifier (read + tests)
```

## Installation

```bash
# From the repo root
pi -e ./src/gentle-cowork.ts
```

Or add to your agent directory extensions folder:

```bash
cp src/gentle-cowork.ts ~/.pi/agent/extensions/gentle-cowork.ts
```

## Usage

The extension registers `/cowork` as a manual trigger. For automatic delegation, the `tool_call` hook detects when gentle-shell is about to delegate and applies the role orchestration based on the named delegation reason.

## Contributing

Contributions follow the gentle-ecosystem contracts — the full rules live in [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md):

- **Linear-first:** work is tracked in Linear (team `BLA`, project *gentle-cowork*); every PR references its issue as `BLA-N`, and evidence-first GitHub issue templates are the entry point for community reports.
- **Branch model:** `main` is the protected stable branch; feature branches (`feat|fix/<linear-issue>-<short>`) are cut from `dev`, and PRs target `dev`. Releases flow `dev` → `main` through an automated release PR.
- **Conventional Commits** in work-unit slices (~400 authored lines), with chained PRs for anything larger. The suite (`npx vitest run`) must be green and `npx tsc --noEmit` clean — strict TypeScript, no `any` ever — before every PR.

## Versioning

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0/). Versions are automated by [release-please](https://github.com/googleapis/release-please) from Conventional Commits: `feat` → minor, `fix` → patch, breaking changes (`!` / `BREAKING CHANGE:` footer) → major, and `docs`/`chore` never trigger a release. Human-readable history lives in [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT

<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="220" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>
