# Phase 7, Slice 7.3 — Inyección de Contexto Arquitectónico

**Base:** `dev` @ `200cc1c` (Slice 7.2 completado)
**Alcance aprobado:** Phase 7 sola después de Phase 6 probada y dogfooded (decisión 24/oct)
**Branch:** `feat/phase7-context-injection` (desde dev)
**Delivery:** slice ~400 líneas, revisión nativa (riesgo alto: componente 2 — memoria arquitectónica)
**Runner:** Vitest

---

## Specs

- **S1 (dueño, verbatim):** "Todo TaskContract que se asigne a un worker debe llevar adjunto el subgrafo relevante del grafo de decisiones y del registro de deuda técnica: decisiones que afectan al contrato (transitivo), deuda técnica vinculada al contrato (por affectedContracts), y dependencias entre ellas. El worker lo recibe como parte del contexto de arranque y puede consultarlo sin llamadas adicionales al blackboard."
- **S2 (ROADMAP 7.3):** Estructura del contexto inyectado: `ArchitecturalContext` con `decisions` (subgrafo transitivo desde decisiones raíz del contrato), `techDebt` (filtrado por affectedContracts del contrato), `dependencies` (aristas entre decisiones y deuda). Serialización JSON en `TaskContract.architecturalContext` (campo opcional). Migración de `TaskContract` para incluir este campo.
- **S3 (ROADMAP 7.3):** API del blackboard: `getArchitecturalContext(contractId: string)` — computa y retorna el contexto arquitectónico completo para un contrato. Se usa en `assignContract` para adjuntar al TaskContract antes de pasarlo al worker.
- **S4 (guardas, hereda de 6.4/7.1/7.2):** configurable por contrato; default pausa + escalado; degrade suave opción del contrato.
- **S5 (riesgo alto 7.3, decisión 5):** revisión nativa por unidad con auditoría de cobertura de entradas del gate ANTES de la revisión nativa (lección del kilo test).

---

## Tasks

- [ ] **T1** [S1, S5] Workflow doc: este archivo — diseño de la inyección de contexto, estructura `ArchitecturalContext`, API `getArchitecturalContext`, migración de `TaskContract`. **El workflow doc PRIMERO, revisión del dueño, recién entonces TDD.**
- [ ] **T2** [S2] `src/architectural-context.ts` — tipos: `ArchitecturalContext`, `ContextInjectionConfig`; función `computeArchitecturalContext(blackboard, contractId)`; tests RED→GREEN primero.
- [ ] **T3** [S3] Extensión de `src/blackboard.ts` — método `getArchitecturalContext(contractId)`; integración en `assignContract` para inyectar contexto en `TaskContract.architecturalContext`; migración de `TaskContract` para campo opcional `architecturalContext`.
- [ ] **T4** [S3] `src/architectural-context.test.ts` + `src/blackboard.test.ts` — tests de integración: contexto para contrato con decisiones/deuda, contexto vacío, subgrafo transitivo correcto, inyección en assignContract.
- [ ] **T5** [S5] Auditoría de cobertura del gate ANTES de la revisión nativa: árbol limpio, candidate N archivos/X líneas contra `origin/dev`, suite Y tests sobre ese árbol, typecheck limpio.
- [ ] **T6** [S5] Revisión nativa de la unidad 7.3 — lentes: readability + reliability (riesgo alto: memoria arquitectónica).

---

## Log

- **L1 (2026-11-12, dueño — este doc):** Inicio slice 7.3. Slices 7.1 y 7.2 completados (419 tests). La inyección de contexto es el tercer componente de Phase 7 — desbloquea 7.4 (suites validación), 7.5 (compliance).