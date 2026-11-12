# Phase 7, Slice 7.2 — Registro de Deuda Técnica Estructurada

**Base:** `dev` @ `1a7843d` (Slice 7.1 completado, review nativo aprobado)
**Alcance aprobado:** Phase 7 sola después de Phase 6 probada y dogfooded (decisión 24/oct)
**Branch:** `feat/phase7-tech-debt-registry` (desde dev)
**Delivery:** slice ~400 líneas, revisión nativa (riesgo alto: componente 2 — memoria arquitectónica)
**Runner:** Vitest

---

## Specs

- **S1 (dueño, verbatim):** "El registro de deuda técnica vive en el blackboard como estado persistido, consultable por cualquier worker al iniciar. Cada entrada registra: id, título, descripción, ubicación (archivo:línea o símbolo), severidad (critical/high/medium/low), causa raíz, costo estimado (tokens/llamadas/tiempo), gatillo de pago (condición que obliga a resolver), estado (open/acknowledged/paid/waived), timestamp, autor. Filtrado por contrato, severidad, estado."
- **S2 (ROADMAP 7.2):** Estructura: nodos = deuda técnica; aristas = depende_de / bloquea / duplica / mitiga. Serialización JSON en `BlackboardState.techDebt` (nuevo campo v5). Migración v4→v5 por el patrón del blackboard.
- **S3 (ROADMAP 7.2):** API del blackboard: `addTechDebt`, `getTechDebt`, `listTechDebt`, `getTechDebtGraph`, `linkDebtToContract`, `linkDebtToCode`, `updateDebtStatus`, `queryDebt` (filtros: contrato, severidad, estado). Validación fail-closed: deuda sin causa raíz → reject; gatillo de pago obligatorio; código referido debe ser rastreable.
- **S4 (guardas, hereda de 6.4/7.1):** configurable por contrato; default pausa + escalado; degrade suave opción del contrato.
- **S5 (riesgo alto 7.2, decisión 5):** revisión nativa por unidad con auditoría de cobertura de entradas del gate ANTES de la revisión nativa (lección del kilo test).

---

## Tasks

- [ ] **T1** [S1, S5] Workflow doc: este archivo — diseño del registro de deuda técnica, estructura de nodos/aristas, migración v4→v5, API del blackboard, validaciones. **El workflow doc PRIMERO, revisión del dueño, recién entonces TDD.**
- [ ] **T2** [S2, S3] `src/tech-debt.ts` — tipos: `TechDebtNode`, `TechDebtEdge`, `TechDebtGraph`, `TechDebtState`; validación fail-closed; migración v4→v5 (campo `techDebt` opcional en `BlackboardState`); helpers (grafo, dependientes, ciclos); tests RED→GREEN primero.
- [ ] **T3** [S3] Extensión de `src/blackboard.ts` — campo `techDebt` en `BlackboardState`; `STATE_VERSION = 5`; métodos: `addTechDebt`, `getTechDebt`, `listTechDebt`, `getTechDebtGraph`, `linkDebtToContract`, `linkDebtToCode`, `updateDebtStatus`, `queryDebt`; migración v4→v5 en `loadContracts`; persistencia atómica bajo write lock.
- [ ] **T4** [S3] `src/tech-debt.test.ts` — tests de integración: crear deuda, enlazar a contrato, enlazar a código, consultar grafo, migración v4→v5, validaciones fail-closed, query con filtros.
- [ ] **T5** [S5] Auditoría de cobertura del gate ANTES de la revisión nativa: árbol limpio, candidate N archivos/X líneas contra `origin/dev`, suite Y tests sobre ese árbol, typecheck limpio.
- [ ] **T6** [S5] Revisión nativa de la unidad 7.2 — lentes: readability + reliability (riesgo alto: memoria arquitectónica).

---

## Log

- **L1 (2026-11-12, dueño — este doc):** Inicio slice 7.2. Slice 7.1 completado (364 tests, review nativo aprobado). El registro de deuda técnica es el segundo componente de Phase 7 — desbloquea 7.3 (inyección contexto), 7.4 (suites validación), 7.5 (compliance).