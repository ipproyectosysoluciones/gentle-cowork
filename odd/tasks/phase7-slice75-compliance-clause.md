# Phase 7, Slice 7.5 — Compliance por Cláusula

**Base:** `dev` @ `cb35647` (Slice 7.4 completado)
**Alcance aprobado:** Phase 7 sola después de Phase 6 probada y dogfooded (decisión 24/oct)
**Branch:** `feat/phase7-compliance-clause` (desde dev)
**Delivery:** slice ~400 líneas, revisión nativa (riesgo alto: componente 1 — compliance)
**Runner:** Vitest

---

## Specs

- **S1 (dueño, verbatim):** "El contrato declara normativas (ISO 27001, SOC 2, GDPR, HIPAA, PCI-DSS, etc.); el validador verifica la alineación y emite evidencia por cláusula. Cada cláusula normativa se mapea a controles verificables (tests, métricas, evidencia documental). El reporte de compliance es parte del veredicto del verifier."
- **S2 (ROADMAP 7.5):** Estructura: `ComplianceFramework` (ISO27001, SOC2, GDPR, etc.) con `clauses[]` (id, título, descripción, controles[]). Cada control mapea a `ValidationSuite` (7.4) o evidencia documental. `ProjectContract.complianceFrameworks[]` declara qué frameworks aplica el proyecto.
- **S3 (ROADMAP 7.5):** API del verifier: `runComplianceCheck(contractId)` → itera frameworks declarados, ejecuta suites mapeadas, recolecta evidencia por cláusula, emite `ComplianceReport` (framework, cláusula, estado, evidencia, gaps). Integración con `ValidationSuiteRegistry` (7.4) y `ArchitecturalContext` (7.3).
- **S4 (guardas, hereda de 6.4/7.1/7.2/7.3/7.4):** configurable por contrato; default pausa + escalado; degrade suave opción del contrato.
- **S5 (riesgo alto 7.5, decisión 5):** revisión nativa por unidad con auditoría de cobertura de entradas del gate ANTES de la revisión nativa (lección del kilo test).

---

## Tasks

- [ ] **T1** [S1, S5] Workflow doc: este archivo — diseño de compliance por cláusula, frameworks, mapeo controles-suites, reporte de compliance, integración con verifier. **El workflow doc PRIMERO, revisión del dueño, recién entonces TDD.**
- [ ] **T2** [S2] `src/compliance.ts` — tipos: `ComplianceFramework`, `ComplianceClause`, `ComplianceControl`, `ComplianceReport`, `ComplianceEvidence`; mapeo frameworks base (ISO27001, SOC2, GDPR); `ComplianceFrameworkRegistry`; tests RED→GREEN primero.
- [ ] **T3** [S3] `src/compliance.ts` — `runComplianceCheck(contractId, blackboard)` → itera frameworks del contrato, mapea controles a suites (7.4) y evidencia documental, ejecuta, emite `ComplianceReport`; integración con `ValidationSuiteRegistry` (7.4) y `computeArchitecturalContext` (7.3).
- [ ] **T4** [S3] Integración en `src/verifier.ts` — `runNativeVerify` ejecuta `runComplianceCheck` si `ProjectContract.complianceFrameworks` no vacío, agrega `ComplianceReport` al veredicto.
- [ ] **T5** [S3] `src/compliance.test.ts` + `src/verifier.test.ts` — tests integración: framework completo, cláusula con control pasado/fallido, evidencia mixta (suite + documental), reporte agregado.
- [ ] **T6** [S5] Auditoría de cobertura del gate ANTES de la revisión nativa: árbol limpio, candidate N archivos/X líneas contra `origin/dev`, suite Y tests sobre ese árbol, typecheck limpio.
- [ ] **T7** [S5] Revisión nativa de la unidad 7.5 — lentes: readability + reliability (riesgo alto: compliance).

---

## Log

- **L1 (2026-11-12, dueño — este doc):** Inicio slice 7.5. Slices 7.1–7.4 completados (454 tests). Compliance por cláusula es el componente final de Phase 7 — cierra la memoria arquitectónica.