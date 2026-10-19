# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

> **Note:** this file is maintained by
> [release-please](https://github.com/googleapis/release-please) from Conventional
> Commits. Do not hand-edit released sections (`## [x.y.z]`); contribute changes
> through conventional commits (`feat` → minor, `fix` → patch, breaking changes →
> major; `docs`/`chore` never trigger a release) and the automation records them.

## 1.0.0 (2026-10-19)


### Features

* **extension:** add cowork-verifier core (pi --mode rpc spawn) ([f14fbcd](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/f14fbcdd3fba0498c2bd34d61a68efd196508443))
* **extension:** blackboard state module (fail-safe reads, atomic writes) ([afa1e03](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/afa1e03033b51f0ccd140c82d509bb7b44875f58))
* **extension:** blackboard state persistence (Phase 4) ([396563b](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/396563ba1e502edbbdb899504f8a0a120416f19c))
* **extension:** chain core with verifier on the shared transport (atomic tsc cluster) ([e42df53](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/e42df53bcbba52150f77f79c12dd8a672a7d5673))
* **extension:** full planner -&gt; implementer -&gt; verifier chain (Phase 2) ([db8c88b](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/db8c88b92aa9aa1fb116ab0e8c6c619e84179239))
* **extension:** invisible delegation via the tool_call hook (Phase 3) ([d3ac061](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/d3ac06178cf387fa065fa4f0e8619fb9018f6d54))
* **extension:** invisible delegation via the tool_call hook (Phase 3) ([7afa274](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/7afa2746cc487d3c12681c7097194efddd0ecd82))
* **extension:** persist every orchestration transition to the blackboard ([101e553](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/101e553396c6f484dc3e653a0762a43822b192f1))
* **extension:** shared RPC subagent transport module ([1f9b2d1](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/1f9b2d1ec59d21ba0a27a8bf46e5727ba1eadb23))
* **extension:** spawn cowork-verifier via pi --mode rpc (Phase 1) ([d4b192c](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/d4b192c72962cd0b34b60e8ee8aa2c003c05286b))
* **extension:** wire /cowork-verify command with verifier tests ([590e555](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/590e555f9a6e99a69e392b1fb3af016bfeaf85af))
* initial project — README, ROADMAP, extension, agents, skill ([ae22195](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/ae22195dc9f98df5d4f7e04eca5478f6ff54445e))
* **skills:** add gentle-contributions and gentle-linear workflow skills ([ffce88d](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/ffce88d7899f590875665858b143c6f0592c2230))


### Bug Fixes

* **ci:** point release-please at main and drop the invalid package-name input ([ce52151](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/ce52151ad0d7129389144f1bec8331224878ffd4))
* **ci:** point release-please at main and drop the invalid package-name input ([4712206](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/4712206c5876ee6580632732c982a96b32e02572))
* **ci:** sync release-please workflow with main (target-branch pin) ([5e83567](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/5e835679fd5d9f0ceef01f76c711f82cd4397680))
* **extension:** readiness handshake before the first child prompt (BLA-26) ([a76c61c](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/a76c61c2ad1200b2424ef3a96e43185c2f6bb84e))
* **extension:** readiness handshake before the first child prompt (BLA-26) ([5c1b065](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/5c1b065febea53ecc5e9788fe6a08906012b97b3))
* **extension:** register against the real Pi ExtensionAPI ([1eaea1b](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/1eaea1b7d06e55f7c72919c26377ffc279fb4afa))
* **extension:** register against the real Pi ExtensionAPI ([919989a](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/919989a554b3dbf0d5030cf8f09d647130fc6101))
* **extension:** register against the real Pi ExtensionAPI [chain 1/14] ([2f18fea](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/2f18fead5d622d62f70fd6d5ddf329f2173f0f25))
* **extension:** role children never intercept or spawn sub-subagents (BLA-25) ([7e8ab24](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/7e8ab24f8ee8d0c4c06c3123304efa6af9fda115))
* **release-yml-dev:** gentle-cowork Phases 0-4 + CI hardening ([ea8e6b9](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/ea8e6b9da47463dca6bb96cc2376d8f7bbeb74ac))

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
