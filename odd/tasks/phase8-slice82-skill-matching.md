# Phase 8, Slice 8.2 — Matching y Configuración de Workers por Microhabilidad

**Base:** `dev` @ `0252961` (Slice 8.1 completado: taxonomía de microhabilidades con 248 skills, registry singleton, helpers para gap analysis y matching)
**Alcance aprobado:** Phase 8 secuencial después de Phase 7 (decisión 24/oct: Phase 6→7→8 secuencial)
**Branch:** `feat/phase8-skill-matching` (desde dev)
**Delivery:** slice ~400 líneas, revisión nativa (riesgo alto: componente 5 — perfiles técnicos)
**Runner:** Vitest

---

## Specs

- **S1 (dueño, verbatim):** "Phase 8, slice 8.2: el orquestador selecciona worker (o crea perfil RPC con modelo/prompt/herramientas) por microhabilidad × carga × presupuesto restante. El matching debe considerar: (1) microhabilidades requeridas vs declaradas por el nodo, (2) carga actual del worker vs capacidad, (3) presupuesto restante del contrato vs costo estimado, (4) afinidad de dominio/contexto. El worker recibe el contexto arquitectónico inyectado (7.3) + sus microhabilidades declaradas."
- **S2 (ROADMAP 8.2):** Interfaz `WorkerMatcher` con métodos `findBestMatch(requiredSkills, context)`, `estimateCost(skills, context)`, `checkCapacity(nodeId, requiredSkills)`. Registro en `WorkerRegistry` que extiende `NodeRegistration` con `skills: MicroSkill[]`, `currentLoad`, `capacity`, `costPerToken`.
- **S3 (ROADMAP 8.2):** Integración en `TaskContract` — campo `requiredSkills: MicroSkillRequirement[]` (skillId, minProficiency, weight). Al asignar (`assignContract`), el orquestador invoca `WorkerMatcher.findBestMatch` y adjunta `matchedWorkerId` + `estimatedCost` al contrato.
- **S4 (guardas, hereda de 6.4/7.4/8.1):** configurable por contrato; default pausa + escalado; degrade suave opción del contrato.
- **S5 (riesgo alto 8.2, decisión 5):** revisión nativa por unidad con auditoría de cobertura de entradas del gate ANTES de la revisión nativa (lección del kilo test).

---

## Tasks

- [ ] **T1** [S1, S4] Workflow doc: este archivo — diseño del matcher, algoritmo de scoring, integración con `TaskContract`, `WorkerRegistry`, `WorkerMatcher`. **El workflow doc PRIMERO, revisión del dueño, recién entonces TDD.**
- [x] **T2** [S2] `src/worker-matcher.ts` — `WorkerMatcher` class con `findBestMatch`, `estimateCost`, `checkCapacity`; `WorkerRegistry` extendiendo registro de nodos; scoring ponderado (habilidades 40%, carga 30%, presupuesto 20%, afinidad 10%); tests RED→GREEN primero.
- [x] **T3** [S3] Extensión de `src/types.ts` / `src/blackboard.ts` — `TaskContract.requiredSkills: MicroSkillRequirement[]`, `assignedWorkerId`, `estimatedCost`; `WorkerRegistry` extendiendo `NodeRegistration` con `skills`, `currentLoad`, `capacity`, `costPerToken`; integración en `assignContract`; persistencia atómica bajo write lock; tests RED→GREEN.
- [x] **T4** [S3] `src/worker-matcher.test.ts` + `src/blackboard.test.ts` — tests de integración: matching por skills, capacidad, presupuesto, afinidad; fallback cuando no hay match; actualización de carga/costo.
- [ ] **T5** [S5] Auditoría de cobertura del gate ANTES de la revisión nativa: árbol limpio, candidate N archivos/X líneas contra `origin/dev`, suite Y tests sobre ese árbol, typecheck limpio.
- [ ] **T6** [S5] Revisión nativa de la unidad 8.2 — lentes: readability + reliability (riesgo alto: perfiles técnicos).

---

## Log

- **L1 (2026-11-12, dueño — este doc):** Inicio slice 8.2. Slice 8.1 completado (taxonomía 248 skills, registry singleton, 470 tests passing). El matching por microhabilidad es el componente central de Phase 8 — desbloquea 8.3 (dogfooding).
- **L2 (2026-11-13):** T2, T3, T4 completados. Implementado:
  - `src/worker-matcher.ts`: `WorkerMatcher`, `WorkerRegistry`, `findBestMatch`, `estimateCost`, `checkCapacity`, `createWorkerRegistration` con scoring ponderado (skills 40%, load 30%, budget 20%, affinity 10%)
  - `src/types.ts`: `TaskContract.requiredSkills`, `estimatedCost`; `NodeRegistration` extendido con `skills`, `currentLoad`, `capacity`, `costPerToken`, `assignedTasks`
  - `src/blackboard.ts`: `WorkerRegistry` interno, `registerWorker()`, `matchAndAssignContract()` con auto-matching por skills/capacidad/presupuesto/afinidad
  - Tests: 488 passing (491 total), typecheck clean
  - Diff: ~372 líneas (bajo límite ~400)