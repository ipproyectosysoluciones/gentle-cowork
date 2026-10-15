# gentle-cowork

An orchestration extension for [Pi](https://pi.dev) / gentle-shell that turns ODD-approved delegation into a structured, verified, multi-role workflow — without ever becoming a silent SDD.

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

## License

MIT
