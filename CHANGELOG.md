# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

> **Note:** this file is maintained by
> [release-please](https://github.com/googleapis/release-please) from Conventional
> Commits. Do not hand-edit released sections (`## [x.y.z]`); contribute changes
> through conventional commits (`feat` → minor, `fix` → patch, breaking changes →
> major; `docs`/`chore` never trigger a release) and the automation records them.

## [1.2.1](https://github.com/ipproyectosysoluciones/gentle-cowork/compare/v1.2.0...v1.2.1) (2026-11-12)


### Bug Fixes

* **subagent:** enhance error messages for API credits/timeout failures ([a1fb859](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/a1fb8590319a1a2833bfcfcc392d445a05177ad0))
* **zero-trust:** add HTTP responses for admin API mutating endpoints ([a20d450](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/a20d450174b003bd34454f28c2ff4b80fa736859))

## [1.2.0](https://github.com/ipproyectosysoluciones/gentle-cowork/compare/v1.1.0...v1.2.0) (2026-11-12)


### Features

* **PI-T3:** wire Herdr state export to MasterOrchestrator & LocalWorker ([53b323e](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/53b323e33cbc161dac27fe60f9f0ea4d956a81ce))
* **zero-trust:** fix T5.7 role permissions & tests; add Pi package manifest ([#139](https://github.com/ipproyectosysoluciones/gentle-cowork/issues/139)) ([a99c3c0](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/a99c3c0591ed44f19abe3f731e43d0af7c069602))
* **zero-trust:** fix T5.7 role permissions & tests; add Pi package manifest for npm publish ([7f35417](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/7f35417f5fec6baee493eb2e7e931e7dd3732bc3))

## [1.1.0](https://github.com/ipproyectosysoluciones/gentle-cowork/compare/v1.0.0...v1.1.0) (2026-11-11)


### Features

* **blackboard:** Phase 5 T5.1 — file locking + lease/fencing + orphan recovery + version counter + legacy migration ([a0d7024](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/a0d70242f880bff839493f1d9bb20f60175af3cd))
* **contract:** hold the store lock in a directory with a contained dispute ([50d64d1](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/50d64d129669388c14e6cdfd1930381dafb7d390))
* **contract:** interpretation engine — contract → TaskContracts, runtime gates, budget exposure (6.2) ([d1eb4df](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/d1eb4df738629dbe5c902be1927e238232c28807))
* **contract:** ProjectContract schema — fail-closed validation, closed enums, migration chain (6.1b) ([bc91bf3](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/bc91bf35fff2e4369c561bc6dcae809b77125a40))
* **contract:** versioned contract store — atomic 0600 writes, draft/amend with optimistic version, ContractVersionConflict (6.1c) ([e783281](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/e783281bc989706f5263d9cf3f5e6e26fffdd0bd))
* **delivery:** T5.9 remote worker wiring — Dockerfile.worker, container entry, operator CLI with tunnel/provision/teardown, npm scripts ([2e2013a](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/2e2013a9a9465290d747c40178e2d169fe5b5ab4))
* **dogfood:** T5.4 — local two-session dogfooding harness (master/worker) ([d17022e](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/d17022e0bc6a4d94ed37ac770f5779aa1e84f298))
* **dogfood:** T5.4 — local two-session dogfooding harness (master/worker) ([b365d5c](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/b365d5c4ce39ff263126b4b82f514cf69d0e96a1))
* **dogfood:** T5.4/T5.5 — complete dogfood cycle T5.1-T5.4 via blackboard ([c7dad68](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/c7dad685810d4b9cc4da11ed82c187ffc5930910))
* **ext:** add /cowork-dogfood command for native background jobs (PI-T1) ([0046be8](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/0046be8600fb45d85cb2bae4641b66a7ac72ca04))
* **guards:** Phase 6.4 guards evaluation + master enforcement ([d54b85a](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/d54b85af8bdc81c41e0bb68b3bd130acf75696f9))
* **metering:** add Phase 6 dogfood evidence ([1a56ed0](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/1a56ed0d3af2db5d2f1a8c372a2ffde5396f39d2))
* **metering:** Phase 6.3 core + blackboard persistence + metered executor ([896cf11](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/896cf11fa22f174eafc3de201cda672263fb81ca))
* **orchestrator:** T5.8 master/worker orchestration — blackboard sole coordination, lease arbitration, merge-from-disk conflict resolution ([23668e3](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/23668e37a00381ca4b74c2a0aa30e5b4fdac8dad))
* **orchestrator:** T5.9 launcher — pure SSH/cloud-init builders, tunnel/provision/teardown argv, verifyRegistration polling ([c8d9c4d](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/c8d9c4d43ca24290a3ae03fa0d4ea2fa0998b23e))
* **orchestrator:** T5.9 RemoteWorkerBridge — master proxy-writer for remote verdicts, WS-connected assignment routing, remote exit criteria e2e ([b75ddf8](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/b75ddf802a7a86c07157d28a210d45a9f4733853))
* **orchestrator:** T5.9 RemoteWorkerClient — WS implementer node with structured verdict reporting, heartbeats, reconnect ([26f8537](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/26f85373024cc6cd321a61204a23429c4fce1d81))
* **PI-T3:** add Herdr state reporter for master/worker lifecycle ([89ab73c](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/89ab73cb76fc786677d26ee1e370c981683e5b5d))
* **PI-T3:** implement Herdr state export for master/worker lifecycle ([bae0fe7](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/bae0fe7259c6fc5af63a1f3077ef06dff15515db))
* **PI-T3:** implement Herdr state export for master/worker lifecycle ([817a674](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/817a67460133f9d8adffb0bcfda0168886d0459c))
* **PI-T4:** native fallback chains for PR-Agent + orchestration (PI-4) ([8d1e357](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/8d1e35717d03c7541c54890d3b5ba2da5920fa8e))
* **PI-T5:** implement native TUI dashboard with blessed ([53f0f29](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/53f0f29a5db2ce70388fd0f958eeab4a197e7a97))
* **PI-T5:** TUI dashboard design for blackboard (gentle-design + gentle-ui-design) ([069f7fb](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/069f7fb8d36a576dccf018742de323f2f84a573a))
* **security:** add application-level ping/pong for WS resilience (L3) ([9cb81fe](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/9cb81fea339094f2c8e7c17a11290b23d8e8be41)), closes [#106](https://github.com/ipproyectosysoluciones/gentle-cowork/issues/106)
* **security:** add explicit inbound message text length limits (M3) ([e4069db](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/e4069db5ad011ec62d30c8b7b4969b20eef9ddc8)), closes [#101](https://github.com/ipproyectosysoluciones/gentle-cowork/issues/101)
* **security:** add log-sanitizer utility for M2 defense-in-depth ([8588f83](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/8588f83b8836890504554cb1a9b209e85aaac54c))
* **security:** add log-sanitizer utility for M2 defense-in-depth ([4412013](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/4412013d7b43ea87eb19dedb6755fe90971093b2))
* **verifier:** implement runNativeVerify with native review.start/finalize (Phase 2 complete) ([4ec725e](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/4ec725edf90257cd24ebf67578518f272269e810))
* **ws:** T5.6 — WebSocket transport skeleton (port 4318, TLS deferred) ([16004ab](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/16004abb6f6f4f4bfcdcedcddf3a2b853d6d8723))
* **ws:** T5.6 routing complete — role-based delivery, lease fencing, allowlist + ephemeral port fix ([68a0ae1](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/68a0ae11977dede09d3349143e95567d99760660))
* **ws:** T5.9 transport hooks — bridge callbacks, sendTo push, specRef + workerVerdict protocol fields ([964713d](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/964713d01df545b9ed53739c456c3fb9462245a5))


### Bug Fixes

* **admin-api:** add rate limiting for mutating endpoints (M1) ([492f128](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/492f1288694aa05417016f80e478f565a322693b))
* **admin-api:** add rate limiting for mutating endpoints (M1) ([de1c909](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/de1c9093ea265a0e08361ed3292cc6cd396c50eb))
* **allowlist:** atomic writes with temp file + rename (C2) ([0f1c712](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/0f1c7121b746e1f5fa06ae6dd0051ff1f26cbf26))
* **allowlist:** atomic writes with temp file + rename (C2) ([aba726b](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/aba726b719edaf10798627e611458fe97c7cc6dc))
* **blackboard:** final test fixes for exact-match fence validation (C5, H3) ([0e7112b](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/0e7112b570613c74039194f8ad5ec71bf2bc919a))
* **blackboard:** final test fixes for exact-match fence validation (C5, H3) ([0021f32](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/0021f325771628964e509fe2ec5be04937c66b9a))
* **blackboard:** improved file locking with random suffix for test isolation (C5 partial) ([ecd3cb6](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/ecd3cb6414bbda78f6b2f07bbe219f4dee4f8184))
* **blackboard:** improved file locking with random suffix for test isolation (C5 partial) ([5e2886c](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/5e2886cda98652716d4535c14fee2f954d9dad64))
* **contract:** fail closed on a corrupt changelog ([45b6eb8](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/45b6eb880f853bc0731388a58a69a9aec435dcf8))
* **contract:** fail closed when the interpretation clock is not an instant ([a0af5a0](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/a0af5a01df39d9a0a054357e848059594b29e69b))
* **contract:** never delete an owner by path when retiring a lock container ([edb1188](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/edb11882d6a4e625ee696f30e721432d8626e387))
* **contract:** reclaim only provably dead locks and never wedge on corruption ([516e09b](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/516e09bf2c87a354fd138472835f90311eb0b3ec))
* **contract:** refuse a non-Date clock and pin the displaced-lock guarantee ([7cdc8d9](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/7cdc8d985db1e14fb0eeecd47a0a81950f801924))
* **contract:** serialize store writes behind an owner-token lock ([1b23a54](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/1b23a5462e780d7238c8bb1345bb4b132fe09b3b))
* **contract:** steal stale locks atomically instead of deleting them by path ([69b102a](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/69b102aeca00c840b0992cd54daadc59a55e0e72))
* **contract:** treat an unlistable lock container as unreadable, not empty ([e334c6e](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/e334c6e23ef283363e992febe07a71adf9de3e78))
* **delivery:** add tsx as devDependency — npm run worker:remote was inoperante without global tsx ([c8aa751](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/c8aa7513332bce47ea0408159f4a6effe0e2e0f4))
* **delivery:** install dependencies in worker image — npm ci from lockfile + global tsx; container smoke green (register + heartbeats via bridge) ([81adc8c](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/81adc8cb4953711d519778c52711a5a694cb27d1))
* **deps:** force undici &gt;= 8.12.2 — CVE-2026-109869 DoS via excessive content-encodings ([70d78eb](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/70d78eb26c7cd0e6c476216c808063cd9573ee92))
* fix subagent timeout and promptAndWait signature ([0d783d9](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/0d783d96a6f3697f80dc6f0c1d580e0ec5c19525))
* **guards:** atomic evaluate-and-assign eliminates TOCTOU on budget guards ([#129](https://github.com/ipproyectosysoluciones/gentle-cowork/issues/129)) ([e074838](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/e074838109d25d026d0ab5f5f89b8ec928231c89))
* **guards:** log loudly when the pause gate cannot record ([#127](https://github.com/ipproyectosysoluciones/gentle-cowork/issues/127)) ([61b3de6](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/61b3de61eaf94956ffc4fe24946d56819945147f))
* **metering:** never mask the worker's error with a metering write failure ([#128](https://github.com/ipproyectosysoluciones/gentle-cowork/issues/128)) ([ff82157](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/ff82157930d09f3809e4a2c2f1ea6e10e4dd4812))
* **pr-agent:** correct repo settings file (real sections + NVIDIA model) ([9451b74](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/9451b740b3a754c42161f33dd799d8f384821646))
* resolve TypeScript syntax error and fence comparison bugs ([f55c7a7](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/f55c7a71fb3384387dc962466997a6cb51b4d16f))
* **security:** C8, C10, C11, C12 — path validation, projectCwd validation, signed verdicts, role attestation ([7660a69](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/7660a699123e86e8d3d0d70aca1f114ec35b0f68))
* **security:** C8, C10, C11, C12 — path validation, projectCwd validation, signed verdicts, role attestation ([9ab7c6e](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/9ab7c6e7ef322a0e07ea5326045b66e192427226))
* **security:** H1-H7 high severity fixes — allowlist check timing, env validation, crypto fences, merge writer verification, budget limits, replay protection, secure key erasure ([2a83495](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/2a834952eaf75312040969c5d33281ba2c0dc15d))
* **security:** H1-H7 high severity fixes — allowlist check timing, env validation, crypto fences, merge writer verification, budget limits, replay protection, secure key erasure ([656912f](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/656912f37f7f066b392fddede1cbacb8d9c3ef2b))
* **security:** L1, L2 - security headers and audit logging for admin API ([124c9ab](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/124c9ab1684af35bdc832b14bd8a15cba1d0c7ba))
* **security:** L1, L2 - security headers and audit logging for admin API ([a6b2e60](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/a6b2e607508b886c373a97de19c7b0b766b8d3d1))
* **security:** resolve CodeQL alerts - unbiased fence generation + mTLS cert verification ([6efbcf0](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/6efbcf0fc56fd69c11e0acee1128e380bfdfa0c3))
* **subagent:** validate spawn options — provider, model, cwd, cliPath, extraArgs, env (C4) ([efb1c59](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/efb1c59faead6b8a77857b7721ef1532b9b96046))
* **subagent:** validate spawn options — provider, model, cwd, cliPath, extraArgs, env (C4) ([210fb75](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/210fb7526268f467a8262543317be6fa5e7ae122))
* **worker:** add missing budget/budgetUsed properties to LocalWorker ([ea26b07](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/ea26b07862846a750220a6d0c82653ca7e183d9d))
* **worker:** add missing budget/budgetUsed properties to LocalWorker ([e1f9667](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/e1f9667af87657455075780b84b39cf6876ef90c))
* **ws:** add wss:// support with TLS config (C6) ([e2aad35](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/e2aad35ca162fa32fb41057e48f8efa3f9aa7c5f))
* **ws:** add wss:// support with TLS config (C6) ([0a20bef](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/0a20bef2cb0c4d36587f665be8fc0abfe888a12f))
* **ws:** message size limits, JSON depth limit, rate limiting (C3, C7, C9) ([98868a7](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/98868a75909060bb2b5e52d7838b14022c8e746b))
* **ws:** message size limits, JSON depth limit, rate limiting (C3, C7, C9) ([a82b087](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/a82b087066c73bf0e1050b799c83fd2482f66729))
* **zero-trust:** implement real mTLS with x509 certs (C1) ([30b7178](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/30b7178610c53ddf125b33b6ba393ad9440f6ee4))
* **zero-trust:** implement real mTLS with x509 certs (C1) ([85646bb](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/85646bb9df729e910224d86ece5ec5807be8bf2f))
* **zero-trust:** T5.7 tail — server hardening green, honest TLS deferral, ws tests reanimated ([4be1e87](https://github.com/ipproyectosysoluciones/gentle-cowork/commit/4be1e87facbb3abb4003a9c1aca1db3c4cfd1f25))

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
