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

## Prerequisites

- **Node.js ≥ 24** (the project is pure ESM)
- **pnpm** (or npm) as package manager
- **Pi / gentle-shell ≥ 1.2.0** — this is an extension for that harness, not a standalone tool
- **Git**
- For multi-node (Phase 5): two or more Pi sessions on the same machine. Remote workers over the network (SSH/Docker VPS, TLS/mTLS) are the next slice (T5.9) — not available yet.

## Installation

```bash
# 1. Clone and install dependencies
git clone https://github.com/ipproyectosysoluciones/gentle-cowork.git
cd gentle-cowork
pnpm install          # or: npm install

# 2. Sanity check — both gates must be green
npx tsc --noEmit      # strict TypeScript, zero errors
npx vitest run        # full suite

# 3. Load it into your Pi session
pi -e ./src/gentle-cowork.ts
```

Or install it permanently in your agent extensions folder:

```bash
cp src/gentle-cowork.ts ~/.pi/agent/extensions/gentle-cowork.ts
```

## Usage

The extension registers `/cowork` as a manual trigger. For automatic delegation, the `tool_call` hook detects when gentle-shell is about to delegate and applies the role orchestration based on the named delegation reason.

To watch the extension coordinate itself (two Pi sessions — a master and a worker — building tasks through the shared blackboard):

```bash
npm run dogfood:run
```

To run a worker on a remote VPS (Docker container over an SSH reverse tunnel — T5.9):

```bash
npm run worker:remote -- --host <vps-host> --user <vps-user> \
  [--key <ssh-key-path>] --token <allowlist-token> \
  --env OPENAI_API_KEY=... --expected-node <worker-node-id>
```

The launcher provisions the VPS (installs Docker, writes `/etc/gentle-cowork/worker.env` with mode 0600, starts the worker container with `--restart unless-stopped`), opens the SSH reverse tunnel to the master's WS port, and verifies the worker's registration on the blackboard. Teardown: append `--teardown`. Model credentials travel only through the env file — never through chat, never baked into the image.

## Notes (read before using)

- **Not a standalone binary.** The extension only routes; the intelligence stays in your Pi/gentle-shell session. Without the host agent it does nothing.
- **Multi-node maturity (Phase 5).** The local stage is complete: sessions on the same machine coordinate through `.gentle-cowork/blackboard.json` with file locking, leases with monotonic fencing tokens, and version-counter conflict merge. The WebSocket transport (port `4318`, configurable, bound to `127.0.0.1`) is a skeleton for the upcoming remote slice — **TLS/mTLS is not implemented yet; do not expose the port publicly**.
- **Verifier authority.** The `cowork-verifier` role only ever runs on the master session — workers never verify, they execute.
- **Workers are subprocesses.** A worker is a `pi --mode rpc` child process that inherits the model configuration of the session that spawned it.
- **Quality gates.** Strict TypeScript (`no any`), full suite and typecheck green before every PR — the same contract the extension enforces on the agents it orchestrates.

## Contributing

Contributions follow the gentle-ecosystem contracts — the full rules live in [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md):

- **Linear-first:** work is tracked in Linear (team `BLA`, project *gentle-cowork*); every PR references its issue as `BLA-N`, and evidence-first GitHub issue templates are the entry point for community reports.
- **Branch model:** `main` is the protected stable branch; feature branches (`feat|fix/<linear-issue>-<short>`) are cut from `dev`, and PRs target `dev`. Releases flow `dev` → `main` through an automated release PR.
- **Conventional Commits** in work-unit slices (~400 authored lines), with chained PRs for anything larger. The suite (`npx vitest run`) must be green and `npx tsc --noEmit` clean — strict TypeScript, no `any` ever — before every PR.

## Versioning

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0/). Versions are automated by [release-please](https://github.com/googleapis/release-please) from Conventional Commits: `feat` → minor, `fix` → patch, breaking changes (`!` / `BREAKING CHANGE:` footer) → major, and `docs`/`chore` never trigger a release. Human-readable history lives in [`CHANGELOG.md`](CHANGELOG.md).

## License

Released under the [MIT License](LICENSE) — Copyright © 2026 Bladimir Parra.

> Credits: the WebSocket framing pattern of the multi-node transport reuses the daemon protocol from **dot-telegram**, created by **Daniel**. Thank you for the solid foundation.

<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="220" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>
