# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

> **Note:** this file is maintained by
> [release-please](https://github.com/googleapis/release-please) from Conventional
> Commits. Do not hand-edit released sections (`## [x.y.z]`); contribute changes
> through conventional commits (`feat` → minor, `fix` → patch, breaking changes →
> major; `docs`/`chore` never trigger a release) and the automation records them.

## [Unreleased]

The work below constitutes the initial **0.1.0** milestone — [ROADMAP](ROADMAP.md)
Phases 0–4.

### Added

- Phase 0 — project skeleton: `/cowork` command entry point, `TaskContract` type,
  and the planner/implementer/verifier role definitions (`ae22195`).
- Phase 1 — verifier spawn: `cowork-verifier` subagent via `pi --mode rpc`
  returning structured `APPROVE`/`CHANGES` verdicts (`d4b192c`).
- Phase 2 — full orchestration chain: planner → implementer → verifier with a
  `CHANGES` retry loop (max 3 attempts) (`db8c88b`).
- Phase 3 — invisible delegation: the `tool_call` hook detects delegation by
  named reason and applies role orchestration; native delegation proceeds
  untouched when no reason exists (`7afa274`).
- Phase 4 — blackboard state: shared JSON state file with `TaskContract`
  persistence (pending → in_progress → completed/failed) that survives daemon
  restarts (`396563b`).
- Contribution and issue-management contracts: `gentle-contributions` and
  `gentle-linear` skills (`ffce88d`).

### Fixed

- Extension registration against the real Pi `ExtensionAPI` (`919989a`).
