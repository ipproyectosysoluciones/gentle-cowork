# gentle-cowork extension — ODD feature document

Multi-role orchestration extension for Pi/gentle-shell that respects ODD: delegation by named reason (never size), spec passed by reference, flat delegation tree. Long-term roadmap source of truth: `ROADMAP.md` (Phases 0-5). Full proposal: Obsidian vault `belzebuth`, folder `01-Proyectos/Gentle-CoWork` (3 notes). Phase 0 (skeleton) is complete at commit `ae22195`.

## Specs

- **S1 — Re-align the skeleton with the real Pi ExtensionAPI.** User confirmation: "Sí, arrancá" (option description: "Re-alineo el esqueleto con la API real de ExtensionAPI y arranco Phase 1 (verificador único)"). The current skeleton (`src/gentle-cowork.ts`, commit `ae22195`) uses `api: any` with an invented API surface; it must register against the real Pi 1.2.0 `ExtensionAPI` (`pi.registerCommand(name, opts)`, `pi.on(event, handler)`), be typed without `any` (workspace TS playbook prohibition), and be verified via typecheck + unit tests of registration + extension load.
- **S2 — Phase 1: Single-role verification.** Verbatim from `ROADMAP.md`: "Spawn a `cowork-verifier` subagent (`pi --mode rpc`) with a test prompt"; "Receive the verifier's verdict (APPROVE/CHANGES)"; "Log the verdict to the launcher log". Exit criteria: "A verifier subagent runs, reads a test file, and returns a structured verdict."
- **S3 — Phase 2: Planner → Implementer → Verifier chain.** Verbatim from `ROADMAP.md`: "`cowork-planner` receives an objective, returns a plan (list of steps with scope + criteria)"; "`cowork-implementer` receives one step, executes it, returns an artifact summary"; "`cowork-verifier` receives the artifact, runs tests, returns a per-S# verdict"; "If verdict is `CHANGES`, loop back to implementer (max 3 retries)". Exit criteria: "A complete plan → implement → verify cycle runs without manual intervention."
- **S4 — Phase 3: ODD integration (invisible delegation).** Verbatim from `ROADMAP.md`: "Hook into `tool_call` — detect when gentle-shell is about to delegate (tool names containing \"delegate\" or \"subagent\")"; "When detected and a named reason exists → apply role orchestration instead of native delegation"; "When no reason exists → let native delegation proceed (do NOT intercept)"; "The user should never need to invoke `/cowork` explicitly". Exit criteria: "Delegation happens naturally; the user describes what they need and the orchestration is invisible."
- **S5 — Phase 4: Blackboard state.** Verbatim from `ROADMAP.md`: "A shared state file (JSON) that all roles read/write"; "TaskContract persistence (pending → in_progress → completed/failed)"; "Survives daemon restart (state file on disk)". Exit criteria: "A delegation can be interrupted and resumed without losing the contract state."
- **S6 — Phase 5: Multi-node scaling (future).** Verbatim from `ROADMAP.md`: "Phase 5 — Multi-node scaling (future)". Out of current scope; to be started only by an explicit user decision once Phases 1-4 are complete.

## Tasks

- T1 · S1 · inline · commit: `919989a` · DONE — Re-align `src/gentle-cowork.ts` with the real `ExtensionAPI` (typed, no `any`); registration unit tests (RED with current skeleton → GREEN after re-alignment); typecheck and load verified. Verified: vitest 5/5, tsc clean, real load check LOAD_OK. Also added `.gitignore`, `test` script, `allowImportingTsExtensions`.
- T2 · S2 · inline · commit: `d4b192c` · DONE — Phase 1: `/cowork-verify` spawns a cowork-verifier subagent (`pi --mode rpc`) with a test prompt, parses the structured APPROVE/CHANGES verdict per S#, logs it to the launcher log (stderr), records it as a TaskContract artifact; transport injectable; spawn inherits the active session model. Verified: vitest 26/26, tsc clean, real end-to-end spawn returned APPROVE with per-S# evidence.
- T3 · S3 · inline · commit: `db8c88b` · DONE — Phase 2: `/cowork-chain` runs the full chain; verified end-to-end (planner 1 step → implementer created docs/phase2-demo.md in scope → verifier APPROVE with byte-level evidence, running the project suite itself). Per-turn timeout 600s from measured evidence (~339s real implementer turn).
- T4 · S4 · inline · commit: `7afa274` · DONE — Phase 3: the tool_call hook blocks named-reason delegations, runs the chain in the background, and reports the result back via pi.sendMessage (customType gentle-cowork-chain-result, triggerTurn: true, display: true); no named reason → native delegation proceeds untouched. vitest 52/52, tsc clean.
- T5 · S5 · delegated (gentle-ai-worker mvaphhj4-1-7zq6) · commit: `396563b` · DONE — Phase 4: blackboard persistence; versioned JSON at `<cwd>/.gentle-cowork/blackboard.json` with fail-safe reads and atomic writes; `session_start` reload restores contracts, `lastContract` and gc/vc/ch id numbering; every orchestration transition persists (interception → in_progress, chain start/result → completed/failed, thrown chain → failed, verify → completed with verdict); vitest 68/68, tsc clean, verified by the parent before commit.

## Log

- L1 (2026-10-15, original request verbatim): "Vamos a comenzar con el proyecto gentle-cowork, como aún no es una extensión oficial ni de Pi, ni de gentle-shell vamos a crear una branch alterna en el momento de integrarla a gentle-shell para no hacer ruido con la versión estable de gentle-shell, leer bien el  agente, readme y documentación, tambien adjunto la propuesta del proyecto la cual se encuentra en obsidian carpeta 01-Proyectos/Gentle-CoWork, cuando tengas todo claro me informas para comenzar el desarrollo"
- L2 (2026-10-15, confirmation): user selected "Sí, arrancá" — "Re-alineo el esqueleto con la API real de ExtensionAPI y arranco Phase 1 (verificador único)". Full phase plan approved; Phases 2-4 are tackled sequentially as each prior phase closes; Phase 5 is future scope (S6). Work-unit commits on a feature branch are part of this flow; push/PR/merge remain user decisions.
- L3 (2026-10-15, exploration evidence): Phase 0 skeleton (`api: any` + optional chaining) is dead code against the real Pi 1.2.0 ExtensionAPI — loads without errors but registers nothing functional. Real API verified in `docs/extensions.md` of `@earendil-works/pi-coding-agent`: `pi.registerCommand(name, { description, handler })`, `pi.on("tool_call", (event, ctx))` with `{ block, reason }` or input mutation, `ctx.executeTool(name, args, { signal, onUpdate })`, `pi.appendEntry()` for durable state. Workspace TS playbook: strict mode, never `any`. Recorded in Engram (ids 2336/2337).
- L4 (2026-10-16, T2 evidence): Phase 1 exit criteria verified end-to-end — a real `pi --mode rpc` child (same pi installation via realpath, model `nvidia/z-ai/glm-5.3` inherited from the session) read `src/types.ts` and returned a structured APPROVE verdict with per-S# evidence, logged to launcher stderr (job-5, 34s). Intermediate defect fixed en route: `resolveDefaultCliPath` returned the relative fallback `dist/cli.js` because `process.argv[1]` is the launcher symlink (`/home/linuxbrew/bin/pi`), not the real cli.js, and RpcClient resolves a relative cliPath against the child's cwd; fixed with `realpathSync` + pi-package validation + package-based fallback + explicit throw (no relative paths). Environment note: the user's gentle-shell defaultModel (`moonshotai/kimi-k3`) hit end-of-life 2026-10-15; the spawn inherits the active session model instead.
- L5 (2026-10-16, T3 integration evidence): First /cowork-chain integration failed silently (headless -p runs do not show ctx.ui.notify); the retest with per-turn timeout raised to 300s and chain progress logged to the launcher log gave the diagnosis: cowork-planner completes its turn and returns 1 step; cowork-implementer hangs at attempt 1 until the 300s turn timeout with empty child stderr (child alive, waiting). Leading hypothesis: the child emits an extension_ui_request (e.g. a write confirmation from an inherited agent-home guard) that the transport never answers, deadlocking headless turns. Confirming with a direct RpcClient probe (diag-spawn.mjs, temporary) before any design change. Related latent defect found while building the probe: the createRequire fallback in resolveDefaultCliPath cannot resolve this package (its exports map has no "require" condition — ERR_PACKAGE_PATH_NOT_EXPORTED); the fallback now uses import.meta.resolve.
- L6 (2026-10-16, T3/T4 evidence): T3 verified end-to-end — chain APPROVE in 7m49s with 600s per-turn timeouts; the verifier checked criteria byte-level (od -c) and ran the project suite itself (49/49 at that point). Probes 1-3 ruled out headless write guards: turns that read the full spec take ~250-340s, so the earlier 180s/300s timeouts were the cause; timeouts calibrated from measured data. Process lesson: running an edit and a bash script that rewrites the same file in the SAME parallel block tore the test file (tests left without their describe wrapper); repaired by rewriting the file to its exact known state — never parallel-write one file from edit+bash. T4 implemented the invisible-delegation contract; CustomMessage.display is a boolean transcript flag, not a display string.
- L7 (2026-10-16, T5 evidence): T5 implemented by a delegated gentle-ai-worker and independently verified by the parent before committing (suite 68/68, tsc clean, no `any`, only allowed surfaces dirty, blackboard.ts spot-checked). Accepted deviations (from the worker report, with reasons): Phase 4 keeps the extension as the single writer on behalf of the read-only roles (the file is the Phase 5 substrate); wiring tests pin the raw on-disk JSON contract; /cowork-verify persists only the completed contract; the pending → in_progress lifecycle is exercised at module level. Phase 5 note: whole-file last-writer-wins writes will need merge/locking for multi-node. **ROADMAP Phases 0-4 complete on feat/gentle-cowork-extension** (ae22195 → 919989a → d4b192c → db8c88b → 7afa274 → 396563b); Phase 5 (multi-node) remains future scope pending an explicit user decision.

---

## Platform Integration: Gentle Shell v4.7 (post-Phase 4)

**Context:** Gentle Shell v4.6/v4.7 introduce native platform primitives that overlap with gentle-cowork's custom infrastructure. This section tracks the migration from custom implementations to native platform primitives — **reducing maintenance surface while preserving domain orchestration value (blackboard, budgets, ODD contracts, metering).**

**Principle:** *Dejar de construir infra, usar nativo. Doblar apuesta en dominio.*

### Specs

- **PI-1 (dueño, verbatim):** "Migrar dogfood scripts a background jobs nativos de gentle-pi — eliminar runners custom."
- **PI-2 (decisión):** "Command guards nativos para `/cowork-*` — reemplazar guards custom por native command guards (permitir una vez / por sesión / siempre / denegar; lo que borra datos nunca ofrece 'siempre')."
- **PI-3 (decisión):** "Exportar estado master/worker a Herdr state file — un archivo por sesión dice si el agente trabaja, está bloqueado o libre."
- **PI-4 (decisión):** "Fallback chains nativas (8 modelos por agente) — usar native fallback chains en PR-Agent y orchestration."
- **PI-5 (decisión):** "Skill TUI design para dashboard blackboard — visualización en terminal via nueva skill de diseño de TUI."
- **PI-6 (observación):** "gentle-cowork NO compite con Gentle Shell v4.7 — se apila encima. Blackboard, leases, fences, budget guards, ODD contracts, metering = valor diferenciador que el nativo NO provee."

### Tasks

- [x] **PI-T1** [PI-1] Migrar `scripts/dogfood-master.ts` y `scripts/dogfood-worker.ts` a background jobs nativos de gentle-pi
  - Eliminar runners custom (`scripts/run-dogfood.sh` eliminado; `scripts/launch-remote-worker.ts` se mantiene — es la CLI de provisión remota SSH/Docker de Phase 5, no un dogfood runner; su migración operativa a `bash_background` es trabajo separado)
  - Usar `gentle-pi` background jobs API: `/cowork-dogfood <run|master|worker>` muestra la invocación RPC exacta de `bash_background` (la salida del job es la notificación); `scripts/dogfood-native.ts` orquesta `run` (master+worker) en un solo comando
  - Verificar: suite 304 tests pasa, dogfood end-to-end funcional
  - ✅ Evidencia: suite `304 passed | 3 todo (307)`, typecheck clean, dogfood e2e EXIT 0 (4/4 contratos gc-1..gc-4 completados, master+worker coordinando vía blackboard, ~12s)

- [ ] **PI-T2** [PI-2] Command guards nativos para comandos `/cowork-*`
  - Registrar comandos con native command guards
  - Políticas: permitir una vez / por sesión / siempre / denegar
  - Lo que borra datos (reset blackboard, etc.) nunca ofrece "siempre"
  - Verificar: typecheck + tests + carga real

- [ ] **PI-T3** [PI-3] Exportar estado master/worker a Herdr state file
  - Archivo por sesión en `~/.herdr/sessions/<session-id>.json`
  - Estado: `working` | `blocked` | `idle` | `crashed`
  - Incluir: nodeId, role, contracts assigned, last heartbeat
  - Verificar: visible en riel de Gentle Shell

- [x] **PI-T4** [PI-4] Fallback chains nativas (8 modelos) en PR-Agent + orchestration
  - Configurar `model_fallback_chain` en `.github/pr-agent.toml` (ya tenía `fallback_models`)
  - Mapear a native fallback chains de gentle-pi: creado `profile-fallbacks.json` con cadenas por agente
  - Verificar: review automático usa fallback si modelo primario sin cuota
  - ✅ Evidencia: suite `304 passed | 3 todo (307)`, typecheck clean; `profile-fallbacks.json` creado en repo y listo para copiar a `~/.gentle-shell/config/gentle-ai/profile-fallbacks.json`; PR-Agent `fallback_models` alineado con `nvidia/nemotron-3-super-120b-a12b`

- [ ] **PI-T5** [PI-5] Skill TUI design para dashboard blackboard
  - Crear skill `gentle-cowork-tui` bajo `gentle-pi` skills
  - Visualización: contratos pending/in_progress/completed, leases, fences, budget usage
  - Integrar con riel de Gentle Shell
  - Verificar: dashboard funcional en terminal

- [ ] **PI-T6** [PI-6] Documentar decisión arquitectónica: gentle-cowork como capa de dominio sobre plataforma nativa
  - Actualizar README y docs
  - Clarificar: qué es nativo (infra) vs qué es gentle-cowork (dominio: blackboard, budgets, ODD contracts, metering, oracle)

### Log

- L-P1 (2026-11-09, decisión del dueño): "Sí, vale la pena continuar con gentle-cowork — pero evolucionando la arquitectura: dejar de construir infra, usar nativo. Doblar apuesta en dominio (blackboard, budgets, ODD, metering)."
- L-P2 (2026-11-09): Fase 1 completada — gentle-ai 4.4.0 synced, gentle-pi 4.7.0 instalado, tests 304 passing, typecheck clean.
- L-P3 (2026-11-09, PI-T1 aterriza): `scripts/run-dogfood.sh` eliminado; `pnpm run dogfood:run` ahora ejecuta `tsx scripts/dogfood-native.ts run --timeout 180`. `/cowork-dogfood` (extensión) registra el comando que emite la invocación nativa `bash_background` de gentle-pi 4.7.0 para master/worker/run — la salida del job es la notificación, sin polling del runner custom.
  **Bug real encontrado por el dogfood e2e:** `generateFence()`/`generateNonce()` (`src/ws/protocol.ts`) usaban `require("node:crypto")` inline (introducido por el fix CodeQL del bias en `6efbcf0`), lo que revienta en ESM (`require is not defined`) — vitest lo tolera en su transform, tsx no. Fix: import estático de `randomBytes`. El dogfood volvió a correr: EXIT 0, 4/4 contratos completados, coordinación master/worker vía blackboard OK. Lección: los scripts dogfood en tsx son el canario ESM que la suite vitest no cubre.
  **Alcance:** `launch-remote-worker.ts` NO se elimina — es la CLI de provisión remota (SSH/Docker + túnel) de Phase 5 con tests propios, no un runner de dogfood. Migrar su spawn detached + PID file a `bash_background` nativo requiere un VPS real para verificar; queda como trabajo operativo separado, documentado aquí para que el dueño decida.

- L-P4 (2026-11-10, PI-T4 aterriza): native fallback chains configuradas. Creado `profile-fallbacks.json` con cadenas por agente (reviewers, validators, judges, orchestrator, workers). PR-Agent `fallback_models` alineado con `nvidia/nemotron-3-super-120b-a12b`. El runtime nativo de gentle-pi 4.7 maneja el failover automático: al agotar cuota, error de auth o fallo de proveedor, el agente cambia al siguiente modelo en la cadena y continúa la conversación; cada cambio emite warning con nota de precio. `profile-fallbacks.json` listo para copiar a `~/.gentle-shell/config/gentle-ai/profile-fallbacks.json`.
