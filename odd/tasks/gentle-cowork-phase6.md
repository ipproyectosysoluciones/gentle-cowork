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

## Tasks

- [x] **T1** [S1, S4] Workflow doc: `odd/tasks/phase6-slice61-contract-schema.md` —
  el ProjectContract schema v1 (campos, validación, versionado/migración por el
  patrón del blackboard) + el **contrato retrospectivo del T8 completado con datos
  reales** (entregables S6, aceptación 51/51 + E2E en vivo, costo de la provider
  storm, puertas). ✅ **APROBADO por el dueño (25/oct): "producción-quality" —
  todas las decisiones de diseño correctas, #2 destacada (las puertas que
  realmente operaron). Revisión registrada al arrancar el TDD.**
- [ ] **T2** [S2, S3] (tras aprobación del doc) TDD: `src/contract/schema.ts` —
  tipos + validación fail-closed + migración vN→vN+1. Tests primero.
- [ ] **T3** [S3] (tras aprobación) `src/contract/store.ts` — persistencia en
  blackboard con version counter (primitivas T5.1) + ejemplo del T8 como fixture.
- [ ] **T4** [S5] (tras aprobación) campo de presupuesto/puertas declarativo en el
  schema (la evaluación es 6.2/6.4).
- [ ] **T5** [S6] revisión nativa de la unidad con auditoría de cobertura previa.

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
