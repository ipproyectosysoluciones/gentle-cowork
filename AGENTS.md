# AGENTS.md — working conventions for every agent in this repository

Gentle CoWork is the multi-node orchestration extension for the Gentleman
ecosystem: the blackboard with locking/fencing/versioning, the master-worker
orchestrator with Zero-Trust transport, the RPC executor with inherited model
configuration, and the enterprise roadmap (Phases 6-8: the business layer,
the architectural memory, the smart profiles). Every agent working in this
repository follows the same discipline. Read this file before the first
action; re-read it before reporting status.

## The one rule that governs all others

**Never report test or verification status you did not run in this session.**
Pasted transcripts, remembered runs, and "should pass" reasoning are not
evidence. Run the suite, paste the real output, name the exact commands.

History: agents have reported green suites with the package not compiling
and fabricated test counts. The rule exists because of real incidents —
the orchestrator's own gate had a coverage gap (only 2 of the install
entries gated) that a hung test exposed.

## Verification commands

- Full suite: `pnpm test` (vitest)
- A single file: `npx vitest run test/<file>.test.ts`
- Typecheck: `tsc --noEmit -p packages/daemon`
- Protocol build (required after protocol changes): `tsc -b packages/protocol`

Some tests are environment-dependent (npm/network installs, keyring access,
user identity). A failure that reproduces on a clean checkout of `main` is
environment, not regression — say so explicitly with the clean-checkout
evidence instead of fixing blindly.

## Organic Driven Development

- Substantial work gets an ODD task document under `odd/tasks/`. The repo
  convention: descriptive file names, lettered log entries (L1, L2…), and
  the permanent rules learned recorded as binding.
- The enterprise roadmap: `odd/tasks/ROADMAP-enterprise-orchestrator.md`
  (Phases 6-8: the business layer, the architectural memory, the smart
  profiles — the slices ~400 lines each, the chained PRs, the native review
  for high-risk units).
- Task documents carry: the goal, the slices, the evidence per slice, the
  open questions, and the design decisions with their justifications.

## Work-unit commits

- One logical change per commit; tests travel with the code they cover.
- Conventional Commits: `fix(scope): ...`, `feat(scope): ...`, `docs: ...`.
- Never mix unrelated changes in one commit — a mixed branch gets demanded
  split (this happened: a retry PR carrying desktop + Fedora changes was
  demanded split three ways).
- Before pushing: audit the gate coverage if the change touches an
  authorization path — every install/execution entry must be gated or
  explicitly exempted with a documented reason.

## Upstream coordination — the replicable formula

Issues reported with experiments get fixed the same week. The formula:

1. Reproduce with the exact failing test names and the dates.
2. State the conditions explicitly (outside CI, platform, environment).
3. Re-test confirmatorily when the maintainer asks or ships a fix.
4. Verify on the original reproduction machine after the fix lands.
5. Confirm publicly, naming the maintainer's fix.

This repo is the ORIGINAL project (ipproyectosysoluciones). The
Gentleman-Programming copy is the ecosystem's mirror — its sync is the
org's side, not this repo's concern.

## Linear work

- Project tracking lives in Linear (workspace `bladimir-parra-lordastaroth`).
- The CLI: `linear` (brew). Configure the default team once: `linear config`.
- Issue-first: the work tracks an issue; the PR references it; the status
  updates carry evidence — commit hashes, test runs, PR links.
- A status without evidence is a claim, not an update.

## Credentials and environment

- Credentials never travel through chat, issues, PRs, or commits. An env dump
  pasted into a chat leaks every key it carries.
- The secrets live in `~/.env` (sourced by `.zshenv`) or the app vaults;
  reference them by name, never by value.
- Pasting through chat rewrites product names, eats spaces adjacent to `.`,
  and strips underscores from `__pycache__`-style tokens — re-derive exact
  strings from intent, never from a paste.

## Engram memory rule

Children save observations; the host ends the session. An agent working in
this repo saves its discoveries (bug fixes, decisions, patterns) before
returning, and never calls mem_session_end.

## The orchestrator's own agents

`agents/` carries the three orchestrator agents (cowork-planner,
cowork-implementer, cowork-verifier). Their contracts are the design's
authority: the planner is read-only, the implementer is scoped, the
verifier runs the actual tests and never assumes they pass. Changes to
their contracts require the same ODD discipline as any code change.
