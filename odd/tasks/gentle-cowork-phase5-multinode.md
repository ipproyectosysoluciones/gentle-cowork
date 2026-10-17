# gentle-cowork — Phase 5: multi-node scaling (feature tracking)

Master/Worker orchestration for Pi/gentle-shell: a Master (gentle-shell on a VPS) distributing cowork role turns to remote Workers over a zero-trust WebSocket layer. Opened 2026-10-17 after the runtime integration was validated end-to-end (BLA-13 Done: the installed extension ran the full planner → implementer → verifier chain live, verifier APPROVE with byte-level evidence in 7m54s). Implementation starts on an explicit maintainer GO.

## Specs

- S1 · "Master/Worker architecture: gentle-shell on a VPS as orchestrator, gentle-cowork agents on distributed workers" (ROADMAP Phase 5). The orchestrator keeps contract/blackboard authority; workers run role turns (planner/implementer/verifier) as remote subagents.
- S2 · "WebSocket or gRPC communication layer" (ROADMAP Phase 5) — MAINTAINER DECISION (2026-10-17): **WebSocket**.
- S3 · "Zero-Trust security (TLS, per-role permissions, allowlisted workers)" (ROADMAP Phase 5): TLS everywhere; worker identity pinned by allowlist; per-role admission (a worker admitted for verifier turns cannot accept implementer writes).
- S4 · "Horizontal scaling: add workers by deploying new gentle-shell instances" (ROADMAP Phase 5): a new worker joins by configuration, no orchestrator code change.
- S5 · Rollout order — MAINTAINER DECISION (2026-10-17): **local-first**: two nodes on this machine communicating over the real WebSocket layer before any VPS is provisioned; then the VPS pilot.
- S6 · Exit criteria (ROADMAP Phase 5): "Two nodes communicating; a task delegated to a remote worker completes and returns a verdict."

## Tasks

(Routes and commits are assigned when each task starts. Binding maintainer rule: every PR is dimensioned ≤ ~400 changed lines AT CREATION; bigger work is opened as chained PRs from the start.)

- T1 · S1,S2 · route TBD · commit: — Master/Worker transport split: a WebSocket server in the extension + a worker client process that accepts role turns.
- T2 · S3 · route TBD · commit: — Zero-trust layer: TLS, worker allowlist, per-role admission.
- T3 · S5 · route TBD · commit: — Local-first two-node smoke: orchestrator + one worker on this machine; S6 exit-criteria run.
- T4 · S5 · route TBD · commit: — VPS pilot: one remote worker; a delegated task completes and returns its verdict.
- T5 · S4 · route TBD · commit: — Horizontal scaling: second worker, distribution policy, docs.

## Log

- L1 (2026-10-17, maintainer): "La extensión ya esta instalada en gentle-shell para poder comenzar a correr las pruebas en la fase 5" — and, asked about transport and rollout: **WebSocket** for the communication layer, **local-first before VPS** for the rollout. The runtime integration was validated first (BLA-13 Done: full chain APPROVE in 7m54s from the installed extension, with the BLA-25 flat-tree defenses and the BLA-26 readiness handshake in place). This document opens the Phase 5 tracking; implementation starts on the maintainer's explicit GO.
