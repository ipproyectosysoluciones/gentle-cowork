# ROADMAP — gentle-cowork como orquestador de nivel empresarial

> Documento de planificación. Nada se implementa sin la aprobación por slice.
> Base: dev @ 9261e0c (la Phase 5 entregada). El análisis de cobertura: la
> verificación read-only del agente (verificada por el orchestrator principal).

## La visión

gentle-cowork pasa de un orquestador de delegación técnica a una **entidad de
gestión de proyectos de software** capaz de asumir la responsabilidad completa
de un desarrollo empresarial: el contrato define las restricciones, el
orquestador las ejecuta, el oráculo mide los costos, el validador exige la
calidad, y los reportes traducen el progreso al negocio.

## El estado actual (post Phase 5)

La Phase 5 entregó el substrato exacto que las fases siguientes necesitan:
el blackboard multinode con locking/fencing/versioning/orphan-recovery
(T5.1), el orquestador master-worker con Zero-Trust, el executor RPC con
modelo heredado, el ciclo RDD con revisión nativa. Los 6 componentes
empresariales del documento original: **3 ausentes, 3 parciales** (el
análisis de cobertura del agente, verificado por el orchestrator principal —
la precisión confirmada contra el review del T5.8 y el blackboard de la
T5.1).

## Las 6 decisiones aprobadas (24/oct)

1. **El alcance**: Phase 6 sola primero — el negocio desbloquea el resto;
   7/8 después de la 6 probada y dogfooded.
2. **El formato del contrato**: JSON schema versionado con migración (el
   patrón del blackboard). El ejemplo fundacional: **el contrato retrospectivo
   del T8** (la API de admin de dot-whatsapp: sus entregables, su aceptación
   51/51, su costo real vivido en la semana del provider storm, sus puertas) —
   no un schema genérico.
3. **El metering**: wrapper del orquestador (los eventos de uso ya fluyen por
   el runtime — la evidencia: el JSONL del nvidia-monitor captura usage por
   request). Sin dependencia externa.
4. **Las guardas**: configurable por contrato. Default: pausa + escalado al
   maintainer. El degrade suave: la opción del contrato.
5. **El riesgo alto (6.1/6.2/6.4)**: revisión nativa por unidad ✓ — con la
   lección del beta: **la auditoría de cobertura de entradas del gate ANTES de
   cada revisión nativa** (el test de kilo destapó la cobertura parcial).

---

## Phase 6 — La capa de negocio: contrato, presupuesto, reportes

> La fundacional. Desbloquea el oráculo (4) y los reportes (6). Sin el
> contrato, los demás componentes son cosmética (el análisis del agente ✓).

| Slice | Entrega | Componente | Líneas est. |
|---|---|---|---|
| 6.1 | **ProjectContract schema**: entregables con criterios de aceptación, plazos, métricas de calidad, cláusulas de scope, presupuesto (tokens/llamadas/tiempo), puertas de aprobación. JSON schema versionado con migración en blackboard. **El modelo: el contrato retrospectivo del T8.** | 1 | ~400 |
| 6.2 | **Motor de interpretación**: contrato → TaskContracts ejecutables + puertas evaluables en runtime (deadline vencido → gate; cláusula → restricción de scope; presupuesto → límites del oráculo) | 1 | ~400 |
| 6.3 | **Oráculo: metering** — captura de uso (tokens, llamadas, duración) por contrato en el blackboard, acumulable por nodo/proyecto. Wrapper del executor (los eventos ya fluyen ✓) | 4 | ~400 |
| 6.4 | **Oráculo: guardas de presupuesto** — comparación contra el contrato; al acercarse al límite: pausa / re-plan / escalado (configurable, default: pausa + escalado). **Se construye DESPUÉS de una fase de medición sin guardas** — calibrar los umbrales con datos reales | 4 | ~400 |
| 6.5 | **Generador de reportes** — avance desde blackboard+contrato: % entregables, SLA status, evidencias, justificaciones; formatos business + técnico | 6 | ~400 |
| 6.6 | **Dogfooding Phase 6** — construir el cierre de la fase usando contrato+oráculo+reportes propios | 1,4,6 | ~200 |

**El criterio de éxito**: el contrato retrospectivo del T8 modelado y
validado; el metering capturando usage real; un reporte de avance producido
desde el blackboard.

---

## Phase 7 — Memoria arquitectónica y validación profunda

| Slice | Entrega | Componente | Líneas est. |
|---|---|---|---|
| 7.1 | **Grafo de decisiones** en blackboard: decisión ←→ contrato ←→ código (refs), con justificación y estado | 2 | ~400 |
| 7.2 | **Registro de deuda técnica** estructurada (qué/dónde/por qué/costo estimado/gatillo de pago) consultable por todo worker al iniciar | 2 | ~400 |
| 7.3 | **Inyección de contexto arquitectónico**: todo TaskContract lleva el subgrafo relevante (decisiones+deudas+dependencias) al worker | 2 | ~400 |
| 7.4 | **Suites de validación enchufables**: seguridad (SAST básico), rendimiento (umbrales declarados en contrato), mantenibilidad (métricas) — el verifier las ejecuta junto a los S# | 3 | ~400 |
| 7.5 | **Compliance por cláusula**: el contrato declara normativas; el validador verifica la alineación y emite evidencia | 3,1 | ~400 |

**El criterio de éxito**: un worker nuevo hereda el contexto arquitectónico
(decisiones + deudas + dependencias) al iniciar un contrato.

---

## Phase 8 — Perfiles técnicos inteligentes

| Slice | Entrega | Componente | Líneas est. |
|---|---|---|---|
| 8.1 | **Taxonomía de microhabilidades** (concurrency, crypto, db-relational…) declarable en TaskContract y en el registro de nodos | 5 | ~400 |
| 8.2 | **Matching y configuración**: el orquestador selecciona worker (o crea perfil RPC con modelo/prompt/herramientas) por microhabilidad × carga × presupuesto restante | 5,4 | ~400 |
| 8.3 | **Dogfooding Phase 8 + reporte contractual de cierre** | 5,6 | ~300 |

**El criterio de éxito**: el matching por microhabilidad demostrable en un
contrato con requisitos técnicos heterogéneos.

---

## Las dependencias y los gates por fase

```
Phase 6 (negocio) ──→ 6.6 dogfood ──→ aprobación ──→ Phase 7 (memoria+validación)
                                                          │
                                                          ▼
                                              Phase 8 (perfiles) ──→ reporte de cierre
```

Cada slice: diseño en ODD → TDD RED→GREEN → chained PR → revisión nativa
(solo los de riesgo alto: 6.1/6.2/6.4) → merge. La auditoría de cobertura de
entradas del gate: ANTES de cada revisión nativa (la lección del kilo test).

## Los riesgos y las mitigaciones

| Riesgo | Mitigación |
|---|---|
| La velocidad de upstream (decode2: 57 commits en gentle-ai solo ayer) | La disciplina de slices + los chained PRs + el re-plant al merge (el patrón probado esta semana) |
| El metering: la dependencia del runtime de Pi | El wrapper del orquestador — sin dependencia externa (la evidencia: el JSONL del nvidia-monitor ✓) |
| Las guardas prematuras con umbrales inventados | El 6.3 antes del 6.4 — medir una fase sin guardas, calibrar con datos |
| El provider dependency para las revisiones nativas | Los 2 linajes abiertos esperan al relay — la auditoría de entradas reduce la superficie a revisar |
| El contract schema vs los casos reales | El ejemplo fundacional: el T8 retrospectivo (el contrato real vivido ✓) |

## Lo que el beta test aportó a este roadmap

El beta test del ciclo RDD encontró **2 defectos de clase** con evidencia
completa (#5735: el abandon gated por su propio escape; el stop
managed_assets_outdated terminal-intent). La lección aplicada al roadmap:
**la auditoría de cobertura de entradas del gate ANTES de cada revisión
nativa** — el proceso se incorpora a los slices de riesgo alto.

## El timeline indicativo

- Phase 6: 6 slices (~2.2k líneas) — la fundacional
- Phase 7: 5 slices (~2k líneas) — después del 6.6 dogfood
- Phase 8: 3 slices (~1.1k líneas) — después del 6.6 + el 7.x
- Total: ~14 slices, ~4.2-5k líneas — el ritmo: los slices de la Phase 5
  (~400 c/u) como la referencia calibrada
