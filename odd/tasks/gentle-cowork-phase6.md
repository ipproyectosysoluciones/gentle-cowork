# gentle-cowork — Phase 6 (capa de negocio: contrato, presupuesto, reportes)

Objetivo: la fase fundacional del ROADMAP-enterprise-orchestrator — sin el contrato,
los demás componentes son cosmética (análisis del agente ✓). Base: `dev` @ `c8aa751`
(la Phase 5 entregada + fix tsx). Alcance aprobado por el dueño (24/oct): **Phase 6
sola primero; 7/8 después de la 6 probada y dogfooded**.
Branch: `feat/phase6` (desde dev) · Delivery: slices de ~400 líneas, review nativa
por unidad en 6.1/6.2/6.4 **con la auditoría de cobertura del gate ANTES de cada
revisión** (lección del beta) · Runner: Vitest.

## Specs

- **S1 (dueño, 25/oct — verbatim):** "Phase 6, slice 6.1: el ProjectContract schema
  modelado con el contrato retrospectivo del T8 (la API de admin de dot-whatsapp:
  sus entregables, su aceptación 51/51, su costo real de la semana del provider
  storm, sus puertas). El workflow doc primero, mi revisión, TDD."
- **S2 (ROADMAP, decisión 2 del 24/oct):** "El formato del contrato: JSON schema
  versionado con migración (el patrón del blackboard). El ejemplo fundacional: el
  contrato retrospectivo del T8 — no un schema genérico."
- **S3 (slice 6.1 del ROADMAP):** ProjectContract schema: entregables con criterios
  de aceptación, plazos, métricas de calidad, cláusulas de scope, presupuesto
  (tokens/llamadas/tiempo), puertas de aprobación. JSON schema versionado con
  migración en blackboard. El modelo: el contrato retrospectivo del T8. ~400 líneas.
- **S4 (orden de trabajo, dueño):** el workflow doc PRIMERO, revisión del dueño,
  recién entonces TDD. Ningún código de 6.1 antes de la aprobación del doc.
- **S5 (guardas, decisión 4):** configurable por contrato; default pausa + escalado
  al maintainer; degrade suave como opción del contrato (se implementa en 6.4 —
  6.1 solo declara el campo).
- **S6 (riesgo alto 6.1, decisión 5):** revisión nativa por unidad con auditoría de
  cobertura de entradas del gate antes de cada revisión nativa.
- **S7 (ROADMAP, slice 6.2 — verbatim):** "**Motor de interpretación**: contrato →
  TaskContracts ejecutables + puertas evaluables en runtime (deadline vencido →
  gate; cláusula → restricción de scope; presupuesto → límites del oráculo)".
- **S8 (#65 — verbatim, issue del dueño):** "`removeLockIfUnchanged` in
  `src/contract/store.ts` reclaims a lock that looks dead with a
  **check-then-delete** sequence: it stats and reads the lock to compare the owner
  token (`store.ts:201-204`) and then deletes it in a separate call
  (`store.ts:205`). That window is not atomic." … "Make the steal atomic by
  renaming the stale lock to a unique name before deleting it, and deleting only
  that name". Impacto declarado: "Narrow: it needs a pre-existing dead lock
  **plus** two concurrent reclaimers inside a microsecond-scale window. It is not
  a live-traffic blocker, but … A lost update here is silent."
- **S9 (R4-006, revisión nativa del 6.1):** `src/contract/interpreter.ts:77-165`,
  lente resilience, severidad WARNING, disposición *informational* (no bloqueante).
  El texto original del hallazgo no quedó en ningún artefacto alcanzable del
  repo, así que la especificación se fija sobre el defecto **demostrable** en ese
  rango: `interpretContract` hace `now.toISOString()` sobre el reloj inyectado sin
  validarlo, así que un `now` inválido revienta con `RangeError: Invalid time
  value` en vez de fallar cerrado como promete el contrato del módulo. Con un
  `now` inválido toda comparación `now > deadline` es falsa: sin el throw, las
  puertas derivadas quedarían `open` — fail-**open**.

## Tasks

- [x] **T1** [S1, S4] Workflow doc: `odd/tasks/phase6-slice61-contract-schema.md` —
  el ProjectContract schema v1 (campos, validación, versionado/migración por el
  patrón del blackboard) + el **contrato retrospectivo del T8 completado con datos
  reales** (entregables S6, aceptación 51/51 + E2E en vivo, costo de la provider
  storm, puertas). ✅ **APROBADO por el dueño (25/oct): "producción-quality" —
  todas las decisiones de diseño correctas, #2 destacada (las puertas que
  realmente operaron). Revisión registrada al arrancar el TDD.**
- [x] **T2** [S2, S3] `src/contract/schema.ts` — tipos + validación fail-closed
  (enums cerrados) + cadena de migración vN→vN+1, con tests primero. ✅ `bc91bf3`
  (+438 líneas: schema 309 + schema.test 129), mergeado a `dev` en PR #59.
- [x] **T3** [S3] `src/contract/store.ts` — store versionado: escrituras atómicas
  0600, draft/amend con versión optimista, `ContractVersionConflict`; el contrato
  retrospectivo del T8 es el fixture compartido (`src/contract/fixtures.ts`).
  ✅ `e783281` (+311 líneas), mergeado a `dev` en PR #60.
- [x] **T4** [S5] presupuesto y puertas declarativos en el schema (`bc91bf3`); la
  exposición en runtime llega con el intérprete (T7), la evaluación de guardas es
  6.4. ✅
- [x] **T5** [S6] auditoría de cobertura de entradas del gate ANTES de la revisión
  nativa: árbol limpio, candidato 7 archivos/1021 líneas contra `origin/dev`, suite
  222 tests sobre ese árbol, typecheck limpio. ✅ (evidencia en L7)
- [x] **T6** [S6] revisión nativa de la unidad 6.1 — **CERRADA sobre el código
  corregido**: el linaje original `review-eced5971081701cc` quedó en
  `correction_required` (3 CRITICAL de una sola raíz: check-then-write sin
  exclusión mutua) y su candidato congelado está superado; el sucesor
  `review-5c3f8ad41b7e26d9` congeló el primer intento de arreglo, el que el
  verificador independiente rechazó (L17). La revisión se cerró sobre el arreglo
  aterrizado, con linaje nuevo `review-b7d218ea422b2de9` (medium,
  risk/resilience/reliability; base `661121de` árbol `54d12e67` → `dev` `0c3f4d7`
  árbol `d7a08e9`; 9 archivos, 2269 líneas): 3/3 lentes admitidas, `approved`, sin
  corrección, 7 hallazgos informativos no bloqueantes; autoridad **quemada**
  (`gentle-ai.review-acknowledged/v1`). ✅ (evidencia en L20)

### Slice 6.2 — motor de interpretación

- [x] **T7** [S7] `src/contract/interpreter.ts` + tests: contrato → TaskContracts
  (entregables pending) con criterios prefijados por `[kind]`, `specRef` con
  fallback `contract:<id>`, history v1; delivered/blocked → skipped con detail;
  gates declarados evaluados; deadlines derivados fail-closed (malformed →
  overdue); budget y scopeClauses verbatim; `generatedAt` desde reloj inyectado.
  26 tests RED→GREEN, suite 248. ✅ `fbd95d4` (+624 líneas: interpreter 175 +
  interpreter.test 449).
- [x] **T8** [S7] boundary record del slice (L9 + L10). ✅ `4f5209b`

### Deuda post-6.1 (abierta por la revisión nativa del 6.1, no bloqueante)

- [x] **T9** [S8] `removeLockIfUnchanged` reclamaba con check-then-delete; el robo
  del lock es atómico ahora (rename a un nombre único + borrado sólo de ese
  inodo, restore con `link` si el path cambió de manos), con un test de regresión
  que falla contra la implementación anterior y una verificación independiente
  PROVEN (item de riesgo 4). ✅ `69b102a` + `7cdc8d9`
- [x] **T10** [S9] `interpretContract` falla cerrado ante un reloj inválido con
  `ContractInterpretationError` (antes: `RangeError` crudo, y sin el crash todas
  las puertas derivadas quedaban `open` — fail-open), y rechaza también un valor
  que no es `Date`. ✅ `a0af5a0` + `7cdc8d9`

## Log

- **L1 (2026-10-24, dueño — ROADMAP):** las 6 decisiones aprobadas (alcance Phase 6
  sola, formato JSON schema versionado + T8 como ejemplo, metering por wrapper,
  guardas configurables default pausa+escalado, revisión nativa por unidad con
  auditoría de cobertura, la fundacional desbloquea el oráculo y los reportes).
- **L2 (2026-10-25, dueño):** "Phase 6, slice 6.1: el ProjectContract schema
  modelado con el contrato retrospectivo del T8 … El workflow doc primero, mi
  revisión, TDD." + la lección del label "slop" institucionalizada en AGENTS.md
  (los PRs desde fork-main sin rebase llegan como slop; la rama limpia rebasada es
  el único camino).
- **L3 (2026-10-25):** T1 entregado (`phase6-slice61-contract-schema.md`). El
  contrato retrospectivo del T8 usa datos de primera mano de esta sesión: 51/51,
  E2E en vivo (admin API + circuito WS), provider storm (2 stalls de subagentes,
  2×502 de revisión, 1 fallo de output-budget tras 36 min, stop de assets + sync),
  gates reales (decisión de arquitectura, slice boundary, revisión pausada, push).
- **L4 (2026-10-25, dueño):** diseño de 6.1 **APROBADO** — "producción-quality";
  las 5 decisiones de diseño correctas, la #2 (modelar las puertas que realmente
  operaron, no una idealizada) destacada como lo que hace útil al schema. El
  contrato retrospectivo del T8 validado como ejemplo fundacional. Arranca el
  TDD (T2→T3→T5) según el plan §6 del doc aprobado.
- **L5 (2026-10-25, slice boundary):** el slice 6.1 quedó en 2 commits sobre dev
  entrega encadenada por la norma ~400 (PRs de la cadena, SHAs de los
  eslabones en sus bodies; `36a323d` superseded — la rama `feat/phase6`
  queda como registro): docs+diseño (`661121d`), fixture+schema+tests,
  store+tests+records —
  ~1021 líneas desde origin/dev (los docs del ROADMAP pesan la mitad): por encima
  del slice de ~400. El boundary queda registrado; NO se commitea más en
  `feat/phase6` sin decisión del dueño.
- **L7 (2026-10-25, T5):** auditoría de cobertura del gate COMPLETA (árbol limpio,
  candidato = 7 archivos/1021 líneas contra origin/dev, suite 222 corrida sobre
  ese árbol, typecheck limpio). Revisión nativa BLOQUEADA por el proveedor:
  linaje `review-eced5971081701cc` (medium, risk/resilience/reliability, budget
  200) creado; la captura del grupo falló con 404 "Function not found" en el
  relay de resilience (370ms, determinista) — la misma rotura que pausó la
  revisión de T5.9 (`9261e0c`, `f43a0fd`). El linaje queda abierto y reanudable
  vía STATUS fresco. La unidad NO queda bloqueada: el assess previo (risk medium,
  reviewDue false) deja en pie la autoverificación del writer + 222 tests +
  typecheck + auditoría. Pendiente upstream: reparar el relay del revisor
  (pistas: gentle-shell#2355, #63).
- L8-a (2026-10-24, lección de aterrizaje — corrección del maintainer): El PR de aterrizaje agregado (#51, chained/t59-delivery → dev, rebase) mostró +9.706 en el libro de GitHub aunque los 13 slices se revisaron a ~400 c/u — la disciplina se cumplió en la REVISIÓN pero se violó en el ATERRIZAJE. Regla incorporada: **stacked-to-dev con re-apuntado por merge** — cada PR de la pila apunta a `dev`; al mergearse el eslabón N, el N+1 se re-apunta a `dev` (su diff pasa a mostrar solo su slice) — **nunca un PR agregador de aterrizaje**. Aplicado a la cadena 6.1 (#58 → #59 → #60, protocolo comentado en cada PR).

- **L9 (2026-10-25, slice boundary 6.2):** el slice 6.2 (motor de interpretación) quedó en 1 commit sobre `feat/phase6-interpretation`: `src/contract/interpreter.ts` + `src/contract/interpreter.test.ts` — 26 tests RED→GREEN, suite completa 248 passed, typecheck limpio. Contrato T8 interpretado: entregables pending → TaskContracts (id, objective, criteria con prefijo [kind], specRef fallback `contract:<id>`, history v1 con nodeId `contract-interpreter`); delivered/blocked → skipped con detail; gates declarados evaluados (passed con evidence, open blocks, paused pauses); deadlines derivados (hard/soft future→open, past→overdue, null→ausentes, malformed→overdue fail-closed); budget expuesto verbatim; scopeClauses verbatim; generatedAt desde reloj inyectado. Determinismo verificado. Cero pendientes → contracts [] válido. Componente 1 (contrato) cubierto.

- **L10 (2026-10-26, reconciliación del tracking — dueño: "demosle trámite"):** el
  doc había derivado de la realidad: T2–T5 seguían `[ ]` con schema (`bc91bf3`),
  store (`e783281`) e intérprete (`fbd95d4`) ya commiteados y mergeados, y el slice
  6.2 no existía como task (solo en L9). Reconciliado: T2–T4 a `[x]` con su SHA y
  su PR; T5 se parte en auditoría de cobertura (`[x]`, hecha en L7) y revisión
  nativa (T6, `[ ]` **bloqueada por el proveedor**, linaje
  `review-eced5971081701cc`); alta del slice 6.2 con su spec verbatim del ROADMAP
  (S7) y sus tasks T7–T8. Lección de proceso: **la proyección de tasks se actualiza
  en el mismo commit que cierra la task, no al cerrar el slice** — un doc que miente
  invalida el resume de la sesión siguiente, que es exactamente lo que el doc existe
  para evitar.
- **L11 (2026-10-26, norma del slice — institucionalizada por pedido del dueño):**
  los slices 6.1 (1021 líneas) y 6.2 (624 líneas) excedieron la norma ~400. El
  boundary se registró en ambos casos, pero la norma se violó de forma sistemática.
  La norma ya no se confía a la memoria: la regla vinculante queda en `AGENTS.md`
  ("Work-unit commits") con el chequeo mecánico previo al commit
  (`git diff --stat <base>` ≥ 400 líneas añadidas → partir el slice, o registrar la
  decisión de boundary del dueño antes de commitear), y el mismo commit lleva el
  doc actualizado. Verificación de esta norma: `git diff --shortstat` contra la base
  del slice impreso en el cuerpo del commit.
- **L12 (2026-10-26, reintento de los linajes — bloqueo migrado a auth):** STATUS
  fresco de ambos linajes: los dos siguen en `state: reviewing`, autoridad intacta,
  ningún slot consumido (`mutation_performed: false`). `review-eced5971081701cc`
  (6.1) reofrece el grupo completo — risk (0), resilience (1), reliability (2);
  `review-08027998ffe5a173` (T5.9) reofrece solo el slot resilience (1); risk y
  reliability ya están admitidos. Forecast del grupo 6.1: 3 corridas de modelo por
  relay del host. Al ejecutarlo, el relé **falló en 1.5s con 401**:
  `"This API key does not have access to the requested model."` — el 404 del relay
  desapareció, pero el transporte ahora no puede autenticarse contra el modelo del
  revisor (misma clase de error que abortó al modelo previo de esta sesión). **No se
  consume ningún slot y no se reintenta**: la reanudación sigue siendo STATUS fresco
  + binding reofrecido, y depende de restablecer el acceso al modelo del relé de
  revisores, no de nada del repo.
- **L13 (2026-10-26, auditoría de dependencias — corrección de un dato previo):** el
  "5 vulnerabilidades (3 moderate, 2 high)" que reporté en el estado del proyecto
  venía del árbol de instalación de extensiones de Pi (`~/.gentle-shell/agent`), NO
  del repo. `pnpm audit` en este repo reporta **1 moderate**: `minimatch`
  (`>=7.0.0 <11.0.1`, GHSA-g3hv-75wg-m249, DoS por amplificación de globparts) que
  entra por `@earendil-works/pi-coding-agent@1.3.0`, un **devDependency** con pin
  exacto `minimatch: 10.2.6`. Decisión: **no se fuerza el override** a 11.x — violaría
  un pin exacto del harness de Pi y es un salto de major en un glob matcher que la
  suite del repo no cubre; el fix corresponde upstream (pi-coding-agent subiendo su
  pin). Riesgo aceptado y registrado: herramienta de desarrollo, no código
  distribuido. El árbol de extensiones de Pi queda como decisión aparte del dueño
  (10 vulnerabilidades, fixes no rompientes disponibles, `--force` degradaría
  `bash-language-server`).
- **L14 (2026-10-26, RDD del slice 6.2 — mismo 401):** el candidato del 6.2 recibió su
  START propio: linaje `review-8eafdb6eb5115387` (target
  `sha256:c511f0cf…416614`, rango committed-only `067b7f1..8a7f676`, 722 líneas, 4
  archivos: `AGENTS.md`, este doc, `interpreter.ts`, `interpreter.test.ts`), **medium**,
  lentes readability + reliability, budget 200. Forecasteado (2 corridas) y ejecutado:
  falla en **1.07 s** con el **mismo 401** (`"This API key does not have access to the
  requested model"`, `param: model`) que el linaje del 6.1 — `prepared_reviewers: 0`,
  `mutation_performed: false`, ningún slot consumido. Con esto queda probado que el
  bloqueo es del **acceso al modelo del relay de revisores**, global a los tres linajes
  (`review-eced5971081701cc`, `review-08027998ffe5a173`, `review-8eafdb6eb5115387`) y no
  de ningún candidato. **Decisión:** se commitea este registro aunque el commit mueva el
  HEAD del linaje — con el relay inutilizable, la frescura del target no vale nada,
  mientras que el registro durable y el árbol limpio sí; cuando el acceso se restablezca,
  el START fresco sobre el HEAD final es barato y correcto. No se reintenta más.
- **L15 (2026-10-26, diagnóstico del 401 del relay — cierre de la capa de modelos):** el
  401 `"This API key does not have access to the requested model"` (≈1-2s, `stage: pi`)
  NO era de red ni del repo. Causa: los seis perfiles de lentes apuntaban a
  `z-ai/glm-5.3`, **retirado por NVIDIA el 2026-10-28T08:00Z** (410 Gone; verificado con
  completion real contra `integrate.api.nvidia.com`). Además `moonshotai/kimi-k3` (el
  `defaultModel` de Pi) está retirado desde el 2026-10-15, y media docena de perfiles
  usaban prefijos de proveedor **inexistentes** (`nvidia-ultra/`, `nvidia-flash/`,
  `nvidia-zai/` → `pi --model ...` = "Model not found"; los reales son `nvidia`,
  `deepseek`, `openai`, `openrouter`, `anthropic`, `github-copilot`, `opencode`,
  `opencode-go`, `openai-codex`). Repuntados a modelos **verificados con completion
  real**: `nvidia/nvidia/nemotron-3-ultra-550b-a55b` (200 OK) y
  `deepseek-ai/deepseek-v4.1-flash`. Superficies corregidas (backup en
  `/tmp/pi-models-backup-1793934820/`): `profiles.json` (perfil activo + los otros dos),
  `subagents.json` (model_profiles), `models.json` y `settings.json` de **ambos** homes
  (`~/.gentle-shell/agent` y `~/.pi/agent`). El capture seguía fallando en esta sesión
  porque **el proceso Pi resuelve el routing al arrancar**: la reanudación exige salir y
  relanzar Gentle Shell (no resumir sesión). **Reanudación exacta:** STATUS fresco de
  `review-8eafdb6eb5115387` (o `review-eced5971081701cc` 6.1 / `review-08027998ffe5a173`
  T5.9) → capturar el binding reofrecido (forecast → `reviewerRunAcknowledged`). Ningún
  slot consumido en los 8 intentos; ninguna autoridad quemada. **Aparte, defecto
  encontrado:** `~/.codex/config.toml` tiene `model = "gpt-6-sol"` y la cuenta ChatGPT
  rechaza `gpt-6-sol`, `gpt-5.3-codex` y `gpt-5.2-codex` ("not supported when using Codex
  with a ChatGPT account") → el CLI `codex` del entorno está roto hasta repuntarlo.
- **L16 (2026-11-06, la revisión nativa del 6.1 vuelve a correr — y encuentra un
  defecto real):** con el relay reparado (L15) y el proceso relanzado, STATUS
  fresco + binding reofrecido ejecutan por fin el **grupo de 3 lentes**
  (`review-eced5971081701cc`, risk/resilience/reliability): 3/3 admitidos. El
  refuter cierra en `correction_required` con **3 CRITICAL de una sola raíz** y 6
  WARNING: `draft`/`amend` hacen *check-then-write* sin lock ni compare-and-swap
  (`store.ts:129-162`) — dos procesos con la misma `expectedVersion` pasan ambos
  el chequeo y el segundo `rename` descarta en silencio contrato y changelog
  (R1-001, R3-001, R4-CONCURRENT-WRITE); y `load` sólo verificaba que `changelog`
  fuera un array y lo casteaba, así que entradas nulas o desalineadas se
  cargaban y se reescribían hacia adelante (R3-002, R4-CHANGELOG-UNVALIDATED).
  El candidato revisado (`c64eaba3`) y el HEAD actual (`48c4d45d`) son **idénticos
  byte a byte** en `store.ts`/`schema.ts`/`fixtures.ts`: el defecto está en
  `dev`, no sólo en el linaje.
  **Lección de plumbing:** `gentle_review` con `--lineage` pero sin
  `input: {baseRef, committedOnly}` resuelve el scope sucio del worktree y
  responde `applicability: unrelated` + un `start` fresco con una selección de
  untracked espuria (`payload.json`, archivo suelto del dueño); con el `baseRef`
  del linaje responde bien. **Defecto de harness:** `recover` por el facade
  falla determinista con `native-status-unavailable / schema-incompatible` (su
  lectura interna de `review/status`) mientras el binario nativo 4.3.1 responde
  v9 sin problema (exit 0); ejecutado por CLI, `review recover` crea el sucesor
  `review-5c3f8ad41b7e26d9` (target `051963f1…`, `scope_changed`, 10 archivos,
  1780 líneas, budget 200) con **authorization auto-registrada** — el paso de
  aprobación del binding nunca se renderiza. Reportar upstream.
  **Decisión del dueño:** arreglar los CRITICAL **antes** de volver a correr las
  lentes (re-descubrir lo ya sabido quema 3 corridas). Corrección aplicada:
  lock file `contract.json.lock` (O_EXCL, timeout configurable, reclamo por
  staleness a 60s) envolviendo `load → check → update → rename` como una sola
  sección crítica, `ContractStoreBusyError` para el perdedor, `withLock` con
  `finally`, validación estricta del changelog en `load` (entradas objeto,
  `version` entero positivo, `at`/`summary` string, última entrada == `version`)
  y clones defensivos del contrato validado. TDD observado: **RED 8 fallos / 9
  pasan → GREEN 17/17** (`src/contract/store.test.ts`); suite **257 passed | 3
  todo (260)**; `pnpm run typecheck` limpio (exit 0 — ojo: `AGENTS.md` manda
  `tsc -p packages/daemon`, ruta que en este repo no existe); `git diff
  --shortstat` = 296 inserciones, dentro de la norma ~400. El registro viaja con
  la corrección en el mismo commit; el linaje sucesor se re-scopea sobre este
  HEAD para revisar el código arreglado. Follow-ups abiertos: R3-004/R3-005
  (`schema.ts:123`, `schema.ts:250`) y R3-006 (`schema.test.ts:106-129`).
- **L16-a (2026-11-06, native review of 6.1 -> correction chain, slice A):** The review
  of lineage `review-eced5971081701cc` — the three-lens group plus refuter, the first
  run after the reviewer relay was repaired — found **3 CRITICALs from a single root**:
  `draft`/`amend` did check-then-write with no mutual exclusion, so two processes
  pinning the same `expectedVersion` both passed the check and the second `rename`
  silently discarded the contract and its changelog entry. Six WARNINGs came with
  them. The full record lives on `feat/phase6-interpretation` (L16/L17); this chain
  delivers it split to the ~400 norm. **Slice A closes the changelog-integrity
  warning:** `load` only verified that `changelog` was an array and then cast it, so
  null or misaligned entries loaded and were written forward by the next amendment.
  `parseChangelog` now validates entry by entry (object, positive integer `version`,
  string `at`/`summary`, exactly the `1..N` sequence, last entry equal to `version`,
  never empty) and the validated contract is cloned before caching and returning it,
  so a caller cannot mutate stored state through its own reference. TDD: 7 new tests
  (6 rejections plus one proving every shape the store writes still loads); suite
  **229 passed | 3 todo (232)**; `pnpm run typecheck` exit 0; **115 insertions / 8
  deletions**, within the norm. The chain is based on `origin/dev` on purpose:
  `store.ts` and `store.test.ts` are byte-identical between `dev` and the reviewed
  candidate, so this carries no unreviewed 6.2 code (6.2 is not in `dev`).
- **L16-b (2026-11-06, chain slice B):** The write lock with an owner.
  `draft`/`amend` ran `load -> version check -> update -> rename` with no critical
  section at all: two processes pinning the same `expectedVersion` both passed the
  check and the second `rename` silently discarded the contract and its changelog
  entry (the 3 CRITICALs R1-001 / R3-001 / R4-CONCURRENT-WRITE). Every write now
  takes `<contract.json>.lock`, created with `openSync(..., "wx", 0o600)` and
  carrying `pid:token`; the version check, the update and the rename are one
  section; the loser gets `ContractStoreBusyError` naming the lock path (wait
  bounded by the new `lockTimeoutMs` option) instead of being discarded silently;
  and release **verifies the on-disk token** before deleting, so a writer that lost
  the lock never deletes the new holder's. A throwing update callback releases the
  lock in `finally`. This slice deliberately does NOT reclaim locks left by dead
  processes: that, together with the grace window for unreadable owners and the safe
  cleanup, is slice C (the boundary decision is recorded here because the cut falls
  inside the same file). TDD: RED 4 failed / 17 passed against the previous
  implementation -> **29/29** focused; suite **243 passed | 3 todo (246)**;
  `pnpm run typecheck` exit 0; authored size at the ~400 norm with the boundary
  recorded in the same commit, as `AGENTS.md` requires.
- **L16-c (2026-11-06, chain slice C — lock lifecycle):** The lock from slice B could
  stay held by a dead process and, worse, the age-based reclaim its first version
  carried (mtime older than 60s) stole the lock from a holder that was **alive but
  slow**: two writers both reported `ok` at version 2 and one amendment was lost --
  the same R4-CONCURRENT-WRITE loss, now with two honest successes (the independent
  verifier found it and failed that commit). This slice closes the cycle: reclaim
  happens **only** when the lock's pid is provably gone on this host (`ESRCH`), never
  by elapsed time; an unreadable owner (0 bytes after a SIGKILL between `openSync`
  and `writeFileSync`, or garbage) is reclaimed only past
  `LOCK_UNREADABLE_GRACE_MS`, because there is no liveness to consult and without it
  the store wedged forever for writes; `removeLockIfUnchanged` re-reads owner **and**
  mtime immediately before each deletion and aborts when the file changed, so two
  waiters reclaiming the same dead lock cannot delete each other's fresh lock; an
  ownership read right after creation closes that race for the holder; and a failed
  `rename` no longer leaves the contract body in a `.tmp` beside the store. TDD: RED
  2 failed / 23 passed (0-byte and `not-a-pid` shapes) -> **25/25**; suite **239
  passed | 3 todo (242)**; `pnpm run typecheck` exit 0. The independent verifier also
  ran a mutation check (assuming a dead owner without probing makes the live-holder
  test fail), so the test is not vacuous.
- **L17 (2026-11-06, la verificación independiente FAILA el primer arreglo — y el
  arreglo se rehace):** el verificador independiente (item de riesgo 4,
  concurrency) corrió el commit `55ddcb2` con dos experimentos reales de 6
  procesos `tsx` y reprodujo los números del commit (17/17, 257|3, typecheck
  limpio) — pero encontró dos **blockers de la misma raíz**: **B1** el reclamo
  del lock por *mtime* > 60s (`breakStaleLock`) corría **antes** del chequeo de
  deadline, así que un holder vivo pero lento tenía el lock robado; medido: dos
  writers reportaban `ok` en v2 y sólo una enmienda sobrevivía — exactamente la
  pérdida de R4-CONCURRENT-WRITE, ahora con dos éxitos honestos, alcanzable con
  opciones por defecto. **B2** el release era `rmSync(force)` incondicional: el
  holder robado **borraba el lock del ladrón** (demostrado). Más W1 (lock
  huérfano si `writeFileSync` falla tras el `openSync`), W2 (el `.tmp` con el
  cuerpo del contrato quedaba en el directorio si `renameSync` fallaba) y W3
  (la validación ataba sólo la **última** entrada al `version`: `[v9, v1]` y
  `[1, 1]` cargaban). Los tests del primer commit no podían detectarlo: el
  reclamo no tenía costura inyectable ni cobertura.
  **Diseño corregido:** el lock lleva dueño `pid:token`; el reclamo ocurre
  **sólo** cuando el pid es demostrablemente inexistente (`ESRCH`) — el tiempo
  transcurrido no es evidencia de muerte —; el release verifica que el token en
  disco sea el propio (un writer que perdió el lock no borra el del nuevo
  dueño); una lectura de propiedad inmediatamente posterior a la creación cierra
  la carrera entre dos waiters que reclaman el mismo lock muerto; el changelog
  debe ser exactamente `1..N` y coincidir con el `version`; el `.tmp` se borra
  si la escritura falla. TDD observado en orden: **RED 4 fallos / 17 pasan**
  (los 4 tests nuevos contra la implementación de `55ddcb2`) → **GREEN 21/21**;
  suite **261 passed | 3 todo (264)**; `pnpm run typecheck` limpio. `git diff
  --shortstat` del arreglo: dentro de la norma ~400. Pendiente: **una** re-corrida
  del verificador (regla de corrección acotada: una tanda, un rechequeo) y el
  grupo de lentes sobre el candidato corregido.
- **L18 (2026-11-06, RDD del slice 6.2 CERRADO — aprobación reconocida, sin
  corridas nuevas):** el linaje `review-8eafdb6eb5115387` (medium, lentes
  readability + reliability, committed-only `067b7f1..8a7f676`, 722 líneas, 4
  archivos) estaba en `approved` con sus dos resultados de lente capturados y sin
  blocker severo: ninguno de los 8 intentos bloqueados perdió un slot. Para
  reconocerlo hay que **reproducir el árbol congelado** (`8a7f676` es el árbol de
  `ffe1c45`): con el worktree en ese árbol, `review.status` + `input {baseRef,
  committedOnly:true}` devuelve `applicability: current_target` y
  `approved_acknowledgement_required`; `acknowledge-approved` con `lineageId` y
  **sin** `input` (el facade rechaza input como `controller-only-input`) responde
  `native-approved-acknowledgement-completed`: autoridad **quemada**
  (`burn_evidence: gentle-ai.review-acknowledged/v1`), target `sha256:c511f0cf…`,
  delivery por política ordinaria del repo. El código revisado es el que se
  entrega: `interpreter.ts` e `interpreter.test.ts` son byte-idénticos entre
  `8a7f676` y el tip de la rama del slice.
  **Corrección de registro:** el PR #61 **nunca** publicó los dos commits del
  primer arreglo de lock (`55ddcb2`, `719e78a`) — su head remoto era `cc40eac`.
  Esos dos commits viven sólo en la copia local de la rama y están superados por
  la cadena #62-#64; el registro L16/L17 que sólo existía allí viaja ahora por
  este PR como cambio de documentación, sin publicar ese código.
  **Causa raíz del relay de revisores (medida, con path:line):**
  `subagents.json` es un archivo **derivado** — se reescribe en cada
  `session_start` (`applySavedModelConfig` `gentle-ai.ts:11633` →
  `applyModelConfigAsync` `:3089` → `updateSubagentModelProfileAtPathAsync`
  `:2879`) y `applyModelConfigAsync` saltea `PROVIDER_REVIEW_ROLES` (`:3097`),
  que son sólo `review-refuter`/`review-validator`. Por eso refuter y validator
  conservaban lo editado a mano mientras las cuatro lentes volvían a
  `nan/deepseek-v4-flash`. El modelo del revisor no sale de ahí:
  `readReviewerModelConfig` (`:2520`) y `reviewHostRelaySelection` (`:2741`) leen
  la autoridad de routing — `<config home>/models.json` y, por encima de ella, el
  perfil congelado al arrancar. En esta máquina el config home es
  `~/.gentle-shell/config/gentle-ai` (`GENTLE_SHELL_PREFIX=/home/bladimir/.gentle-shell`),
  con `active: nan-full-power` y las seis claves `review-*` en
  `nan/deepseek-v4-flash`. La corrección del relay va **allí** (models.json +
  perfil activo), no en el agent home, y exige reiniciar el proceso.
- **L19 (2026-11-06, landing of the lock stack and the 6.2 slice — rebase merges, admin
  bypass, superseded SHAs):** the four candidates landed on `dev` in one sequence: #62 →
  `45b6eb8`, #63 → `1b23a54`, #64 → `516e09b`, #61 → `de34465`. All four were rebase merges,
  so the SHAs quoted by earlier entries are superseded: `51e0623` → `45b6eb8`, `5511d29` →
  `1b23a54`, `23440ae` → `516e09b`, and the whole 6.2 branch (`fbd95d4` … `c9adb2a`) was
  replayed on top of the lock chain as `d1eb4df … 47f2f62`. Immediately after #64, `dev`'s
  tree was `db6de025…`, byte-identical to the tree the independent verifier measured
  (239 passed | 3 todo, typecheck exit 0) — the reviewed bytes are the landed bytes. Final
  `dev` with 6.2: **265 passed | 3 todo (268)**, 21 test files, `pnpm run typecheck` exit 0,
  tree `ed29cb03…`.
  **Bypass, by explicit owner decision:** `dev` requires one approving review
  (`required_approving_review_count: 1`) and all four PRs were authored by the same account
  that is the only CODEOWNER, so self-approval was impossible. The ruleset declares the
  Admin role as a bypass actor; every merge used `--admin`. Recorded here because it is a
  policy bypass, not a formality.
  **Mechanics that blocked the landing, for next time:** the harness safety layer refuses
  `git push --force*` even when the owner authorizes it in conversation, so the owner ran the
  two force-with-lease pushes himself. Merging `dev` into a PR branch is **not** a workaround:
  the sync merge reintroduced test blocks that the top slice had de-duplicated, and GitHub
  then refuses to rebase a branch carrying a merge commit ("This branch can't be rebased").
  The workable path is rebase locally onto `dev`, ask the owner to push, then rebase-merge.
  The 6.2 doc conflict was resolved by verbatim union (`L8-a`, `L9`…`L16`, `L16-a/b/c`,
  `L17`, `L18`, nothing reworded, nothing renumbered) plus one commit that moved the chain
  slice records after `L16`.
  **Follow-up:** #65 records the residual race in the stale-lock reclaim
  (`removeLockIfUnchanged` is compare-then-delete, `store.ts:197-205`), which the verifier
  rated important but not a blocker.
- **L20 (2026-11-06, the 6.1 native review closes over the landed fix):** the lineage the
  owner named, `review-eced5971081701cc`, is terminally `correction_required`: its three
  lenses and its refuter are admitted, `fix_finding_ids` names the three CRITICALs from one
  root (R1-001 / R3-001 / R4-CONCURRENT-WRITE), and `fix_delta_hash` is still the hash of the
  empty string — no correction was ever recorded inside it. Its frozen candidate (`c64eaba3`)
  and the successor that `review recover` produced (`review-5c3f8ad41b7e26d9`, candidate
  `48c4d45d`) both predate the fix that actually landed, and the bounded correction
  (200 lines) cannot cover ~1200 lines of landed fix, so neither lineage can validate the
  delivered bytes. Both stay as historical records; delivery does not depend on them.
  **The review ran over the corrected, landed candidate instead:** fresh lineage
  `review-b7d218ea422b2de9` (medium; risk + resilience + reliability; base tree `54d12e67`
  → candidate tree `d7a08e9`; 9 files, 2269 lines, correction budget 200). The forecast was
  three host-relay reviewer runs (prompt 118,179 / 118,193 / 118,204 bytes) and all three
  executed on the first attempt — the relay repair of L15 holds. Result: **`approved`** with
  **no correction transition offered**, seven advisory findings, none blocking:
  `R3-STORE-LOCK-RECLAIM-RACE` (`store.ts:197-205`) — the same residual race already filed as
  #65; `R4-001` (`store.ts:167-180`), `R4-002` (`store.ts:52`), `R4-003` (`store.ts:53`),
  `R4-004` (`store.ts:112-125`), `R4-005` (`store.ts:192-220`) and `R4-006`
  (`interpreter.ts:77-165`). Acknowledgement burned the authority
  (`burn_evidence: gentle-ai.review-acknowledged/v1`, target `sha256:fca91059…`), so delivery
  follows ordinary repository policy: nothing is merged, pushed or released by the review.
  **Plumbing learned (both cost a failed call):** a bound `review.status` needs
  `input {baseRef, committedOnly:true}` — without it the facade resolves the worktree scope,
  answers `applicability: unrelated` and offers a spurious fresh start with a wrong untracked
  selection. And the provider expresses its base as a **tree** (`54d12e67`, carried by commits
  `661121de` / `da31db7` / `bb05ecc`); `inspect` and `start` reject that as `baseRef`
  (`base-ref-unresolvable`) — pass the commit that carries the tree, which yields the same
  target identity.
  **Follow-up:** `R4-006` is a new open item (interpreter `buildTaskContracts` 77-165) and
  joins #65 as advisory work, not as a re-review of this candidate.

- **L21 (2026-11-06, T9/T10 — la deuda del 6.1 aterriza, y la revisión nativa del arreglo
  escala por causalidad desconocida):** los dos hallazgos advisory que valían la pena se
  cerraron y aterrizaron en `dev` por PR #68 (rebases: `6338b3c` doc, `69b102a` robo
  atómico, `a0af5a0` reloj, `7cdc8d9` hardening).
  **T9 (#65):** `removeLockIfUnchanged` comparaba y después borraba **por path**, así que un
  segundo reclaimer que ganaba la misma carrera en esa ventana se quedaba sin su lock
  fresco y los dos writers entraban en la sección crítica — la pérdida silenciosa que ya
  describía `R4-CONCURRENT-WRITE`. Ahora: `rename(2)` a un nombre que nadie más conoce
  (gana exactamente uno; el perdedor recibe `ENOENT` y reintenta), verificación del inodo
  movido contra el snapshot que se juzgó muerto, borrado sólo de ese inodo, y
  `link(2)`—atómico y create-only—para devolver un lock que cambió de manos. TDD: el test
  de regresión interleavea un reclaimer concurrente por una costura interna
  (`beforeStaleLockSteal`); contra la implementación anterior **`draft()` tenía éxito
  después de borrar el lock fresco** (RED 1 failed | 25 passed → GREEN 26 passed).
  **T10 (R4-006):** `interpretContract` hacía `now.toISOString()` sin validar el reloj
  inyectado; un `Date` inválido escapaba como `RangeError`, y como `now > deadline` es
  falso para ese reloj, sin el crash las puertas derivadas quedaban `open` — fail-open.
  RED real (`got 'Invalid time value'`) → rechazo tipado `ContractInterpretationError`, más
  `instanceof Date` para callers sin tipos.
  **Verificación independiente (item de riesgo 4):** `gentle-ai-verify`, read-only, contra
  los commits exactos. PROVEN en las dos unidades: reprodujo el defecto previo con la misma
  costura, y los mutation checks (saltar la verificación del inodo / reemplazar el restore
  por `rmSync`) hacen fallar el test nuevo — no es vacuo. El reloj: el digest diferencial
  sobre cuatro relojes válidos es **byte-idéntico** entre `origin/dev` y la rama.
  **La revisión nativa del arreglo cerró `escalated`**, no `approved`: la lente reliability
  levantó seis hallazgos y el refuter no pudo probarlos (`probe unavailable on pi`), así que
  la causalidad quedó desconocida. Cuatro **no sobreviven a la evidencia** — R3-001 decía
  que `renameSync` no estaba importado (está, `store.ts:29`, y lo usan `:224` y `:391` con
  la suite verde); R3-004 decía que el loop reusaba un snapshot viejo (`reclaimAbandonedLock`
  lo relee en cada llamada); R3-006 decía que `{now: undefined}` saltea el reloj por defecto
  (`??` trata `undefined` y `null` como ausentes); R3-002 describe un TOCTOU sobre el nombre
  *robado*, cuyo inodo el rename ya fijó. Dos eran reales y se cerraron en `7cdc8d9`
  (R3-005: un reloj que no es `Date` escapaba como `TypeError`; R3-003: la garantía del lock
  desplazado pasó de comentario a costura + test con `beforeStaleLockRestore`).
  **Residual aceptado y registrado en #69:** el verificador reprodujo una ventana de **tres**
  procesos — A compara S, B lo remueve, C instala su lock y entra en la sección crítica, A
  mueve el lock de C a un costado, D toma el path liberado → C y D concurrentes adentro. Es
  la misma pérdida silenciosa de #65 en una ventana de instrucciones; el código nuevo no
  destruye nada y el release de C ya no puede borrar el lock de D, pero la exclusión no es
  total. Cerrarla de verdad exige tokens de generación en vez de liberar borrando — es un
  rediseño del protocolo de reclamo, no un parche. #69 registra eso más dos items
  preexistentes que el verificador encontró: el cleanup de `createLock` toma su snapshot
  *después* del hecho (comparación vacua, idéntico en `dev`, inalcanzable sin error de I/O)
  y los `*.steal-*` huérfanos no tienen GC.
  **Decisión del dueño:** mergear con la escalación aceptada (la revisión nativa no autoriza
  entrega, pero tampoco la prohíbe — la política del repo decide). Verificado: `git diff
  dc19b48 7cdc8d9` sale vacío (los bytes verificados son los bytes aterrizados) y la suite
  sobre `dev` da **271 passed | 3 todo (274)**, `pnpm run typecheck` exit 0. 239 líneas
  autoradas en 4 commits, dentro de la norma ~400.
