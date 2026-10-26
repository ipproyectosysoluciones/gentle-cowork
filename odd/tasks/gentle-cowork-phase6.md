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
