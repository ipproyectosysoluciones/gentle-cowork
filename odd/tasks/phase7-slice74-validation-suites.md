# Phase 7, Slice 7.4 — Suites de Validación Enchufables

**Base:** `dev` @ `a1edad6` (Slice 7.3 completado)
**Alcance aprobado:** Phase 7 sola después de Phase 6 probada y dogfooded (decisión 24/oct)
**Branch:** `feat/phase7-validation-suites` (desde dev)
**Delivery:** slice ~400 líneas, revisión nativa (riesgo alto: componente 3 — validación)
**Runner:** Vitest

---

## Specs

- **S1 (dueño, verbatim):** "El verifier ejecuta suites de validación declaradas en el contrato: seguridad (SAST básico), rendimiento (umbrales declarados en contrato), mantenibilidad (métricas). Cada suite es un plugin que el verifier carga dinámicamente y ejecuta junto a los S#. El contrato declara qué suites aplicar y sus umbrales."
- **S2 (ROADMAP 7.4):** Interfaz de suite: `ValidationSuite` con `id`, `name`, `version`, `run(context) -> ValidationResult`. Registro en `ValidationSuiteRegistry`. El verifier itera suites declaradas en `ProjectContract.validationSuites[]` y agrega resultados al veredicto.
- **S3 (ROADMAP 7.4):** Tres suites base incluidas:
  - `sast-basic`: análisis estático de seguridad (patrones peligrosos: eval, child_process, fs.writeFileSync sin validación, etc.)
  - `perf-thresholds`: verifica umbrales de rendimiento declarados en `ProjectContract.performanceThresholds` (wallTime, memory, CPU)
  - `maintainability-metrics`: complejidad ciclomática, acoplamiento, cobertura (umbrales en contrato)
- **S4 (guardas, hereda de 6.4/7.1/7.2/7.3):** configurable por contrato; default pausa + escalado; degrade suave opción del contrato.
- **S5 (riesgo alto 7.4, decisión 5):** revisión nativa por unidad con auditoría de cobertura de entradas del gate ANTES de la revisión nativa (lección del kilo test).

---

## Tasks

- [ ] **T1** [S1, S5] Workflow doc: este archivo — diseño de suites enchufables, interfaz `ValidationSuite`, registry, tres suites base, integración en verifier. **El workflow doc PRIMERO, revisión del dueño, recién entonces TDD.**
- [ ] **T2** [S2] `src/validation-suites.ts` — interfaz `ValidationSuite`, `ValidationResult`, `ValidationSuiteRegistry`; funciones `registerSuite`, `getSuite`, `listSuites`, `runAllSuites`; tests RED→GREEN primero.
- [ ] **T3** [S3] `src/validation-suites.ts` — implementación de tres suites base: `sast-basic`, `perf-thresholds`, `maintainability-metrics`; cada una con `run(context) -> ValidationResult`.
- [ ] **T4** [S3] Integración en `src/verifier.ts` — `runNativeVerify` itera `ProjectContract.validationSuites[]`, ejecuta suites registradas, agrega resultados al veredicto.
- [ ] **T5** [S3] `src/validation-suites.test.ts` + `src/verifier.test.ts` — tests de integración: registro, ejecución, umbrales, fallos, resultados agregados.
- [ ] **T6** [S5] Auditoría de cobertura del gate ANTES de la revisión nativa: árbol limpio, candidate N archivos/X líneas contra `origin/dev`, suite Y tests sobre ese árbol, typecheck limpio.
- [ ] **T7** [S5] Revisión nativa de la unidad 7.4 — lentes: readability + reliability (riesgo alto: validación).

---

## Log

- **L1 (2026-11-12, dueño — este doc):** Inicio slice 7.4. Slices 7.1, 7.2, 7.3 completados (431 tests). Las suites de validación son el cuarto componente de Phase 7 — desbloquea 7.5 (compliance).