# Phase 7, Slice 7.1 — Grafo de Decisiones en Blackboard

**Base:** `dev` @ `7a3d87e` (Phase 6 completa + merge main→dev)
**Alcance aprobado:** Phase 7 sola después de Phase 6 probada y dogfooded (decisión 24/oct)
**Branch:** `feat/phase7-decision-graph` (desde dev)
**Delivery:** slice ~400 líneas, revisión nativa (riesgo alto: componente 2 — memoria arquitectónica)
**Runner:** Vitest

---

## Specs

- **S1 (dueño, verbatim):** "El grafo vive en el blackboard como estado persistido, no como archivo aparte. Cada decisión registra: id, título, estado (proposed/accepted/rejected/superseded), justificación, contrato(s) afectado(s), referencias de código (archivo:línea o símbolo), timestamp, autor. Consultable por cualquier worker al iniciar."
- **S2 (ROADMAP 7.1):** Estructura de grafo dirigido: nodos = decisiones; aristas = depende_de / sustituye / bloquea / relaciona. Serialización JSON en `BlackboardState.decisions` (nuevo campo v4). Migración v3→v4 por el patrón del blackboard.
- **S3 (ROADMAP 7.1):** API del blackboard: `addDecision`, `getDecision`, `listDecisions`, `getDecisionGraph` (subgrafo transitivo desde un nodo), `linkDecisionToContract`, `linkDecisionToCode`. Validación fail-closed: decisión sin justificación → reject; contrato referenciado debe existir; código referido debe ser rastreable.
- **S4 (guardas, hereda de 6.4):** configurable por contrato; default pausa + escalado; degrade suave opción del contrato (se declara en schema, evalúa en 7.4).
- **S5 (riesgo alto 7.1, decisión 5):** revisión nativa por unidad con auditoría de cobertura de entradas del gate ANTES de la revisión nativa (lección del kilo test).

---

## Tasks

- [x] **T1** [S1, S5] Workflow doc: este archivo — diseño del grafo de decisiones, estructura de nodos/aristas, migración v3→v4, API del blackboard, validaciones. **El workflow doc PRIMERO, revisión del dueño, recién entonces TDD.** ✅ Aprobado por dueño.
- [x] **T2** [S2, S3] `src/architectural-memory.ts` — tipos: `DecisionNode`, `DecisionEdge`, `DecisionGraph`, `DecisionState`; validación fail-closed; migración v3→v4 (campo `decisions` opcional en `BlackboardState`); tests RED→GREEN primero. ✅ 31 tests passing.
- [x] **T3** [S3] Extensión de `src/blackboard.ts` — métodos: `addDecision`, `addDecisionEdge`, `getDecisionGraph`, `getDecisionSubgraph`, `linkDecisionToContract`, `linkDecisionToCode`; persistencia atómica bajo write lock; migración v3→v4 en `loadContracts`; `STATE_VERSION = 4`. ✅ 66 tests passing (blackboard.test.ts).
- [x] **T4** [S3] `src/architectural-memory.test.ts` + `src/blackboard.test.ts` — tests de integración: crear decisión, enlazar a contrato, enlazar a código, consultar subgrafo transitivo, migración v3→v4, validaciones fail-closed, rechazo duplicados, grafo vacío. ✅ 74 tests passing (blackboard.test.ts) + 31 tests (architectural-memory.test.ts) = 105 tests.
- [ ] **T5** [S5] Auditoría de cobertura del gate ANTES de la revisión nativa: árbol limpio, candidate N archivos/X líneas contra `origin/dev`, suite Y tests sobre ese árbol, typecheck limpio.
- [ ] **T6** [S5] Revisión nativa de la unidad 7.1 — lentes: readability + reliability (riesgo alto: memoria arquitectónica).

---

## Log

- **L1 (2026-11-12, dueño — este doc):** Inicio slice 7.1. Phase 6 completa (321 tests, v1.2.2). El grafo de decisiones es el componente fundacional de Phase 7 — desbloquea 7.2 (deuda técnica), 7.3 (inyección contexto), 7.4 (suites validación), 7.5 (compliance).