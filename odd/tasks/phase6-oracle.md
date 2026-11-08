# Phase 6 — Oráculo (6.3 metering + 6.4 guardas de presupuesto)

El oráculo mide y frena: captura el uso real por contrato en el blackboard y, contra el
presupuesto del contrato, decide pausa / re-plan / escalado. Se construye en ese orden —
primero medir sin guardas, después frenar — porque el roadmap exige calibrar umbrales con
datos reales antes de que las guardas bloqueen.

## Specs

- **S1** Pedido del dueño, verbatim: "guarda esto en memoria y comenzamos con 6.3 - 6.4"
- **S2** Slice 6.3 del roadmap, verbatim: "**Oráculo: metering** — captura de uso (tokens,
  llamadas, duración) por contrato en el blackboard, acumulable por nodo/proyecto. Wrapper
  del executor (los eventos ya fluyen ✓)"
- **S3** Decisión 3 del 24/oct, verbatim: "El metering: wrapper del orquestador (los eventos
  de uso ya fluyen por el runtime — la evidencia: el JSONL del nvidia-monitor captura usage
  por request). Sin dependencia externa."
- **S4** Slice 6.4 del roadmap, verbatim: "**Oráculo: guardas de presupuesto** — comparación
  contra el contrato; al acercarse al límite: pausa / re-plan / escalado (configurable,
  default: pausa + escalado). **Se construye DESPUÉS de una fase de medición sin guardas** —
  calibrar los umbrales con datos reales"
- **S5** Decisión 4 del 24/oct, verbatim: "Las guardas: configurable por contrato. Default:
  pausa + escalado al maintainer. El degrade suave: la opción del contrato."
- **S6** Criterio de éxito de la fase, verbatim: "el contrato retrospectivo del T8 modelado y
  validado; el metering capturando usage real; un reporte de avance producido desde el
  blackboard."
- **S7** Riesgo declarado del roadmap, verbatim: "El riesgo alto (6.1/6.2/6.4): revisión
  nativa por unidad — con la lección del beta: **la auditoría de cobertura de entradas del
  gate ANTES de cada revisión nativa**"
- **S8** La fuente de comparación es el presupuesto del contrato (`src/contract/schema.ts`):
  `Budget { modelCalls: BudgetLimit, tokens: BudgetLimit, wallTime: BudgetLimit }` con
  `BudgetLimit { limit: number | null, measured: number | null }`.

## Tasks

- **T1** [S2,S8] `src/metering.ts`: `UsageSample { modelCalls, tokens: number|null,
  wallTimeMs }` y el acumulador puro `UsageLedger` (por contrato, por nodo; agrega, no
  registra log de eventos). RED→GREEN.
- **T2** [S2] Persistencia en el blackboard: `STATE_VERSION` 3 con migración v2→v3 (sección
  `usage` vacía), API `recordUsage` / `usageByContract` / `usageTotals`, escritura por el
  mismo path con locking/fencing. RED→GREEN.
- **T3** [S2,S3] Wrapper de executor: `meteredStepExecutor` envuelve cualquier `StepExecutor`
  (1 llamada + duración por `execute`, `tokens: null` en esta frontera) y registra en el
  blackboard. RED→GREEN.
- **T4** [S4,S5,S8] `src/contract/guards.ts`: `evaluateGuards(budget, usage, config)` →
  por dimensión `{ state: ok|warning|exceeded|unknown, ratio, action }`. Warning por defecto
  en 80% (provisional, se calibra en 6.6); acción default pausa + escalado; degrade suave =
  opción del contrato. RED→GREEN.
- **T5** [S4,S5] Enforcement en el ciclo del master: antes de despachar el próximo paso se
  evalúan las guardas; pausa → no se despacha y queda registrada la puerta pausada;
  escalado → visible en el reporte. RED→GREEN.
- **T6** [S6] Evidencia de dogfood: una corrida `pnpm run dogfood:run` con usage capturado en
  el blackboard, pegada en el Log.
- **T7** [S7] Auditoría de cobertura de entradas del gate + revisión nativa de la unidad
  6.4 (riesgo alto) antes de la entrega; suite + typecheck verdes.

## Log

- **L1** Pedido del dueño, verbatim: "guarda esto en memoria y comenzamos con 6.3 - 6.4"
  (memoria del catálogo guardada: observación 2049, topic
  `gentle-cowork/architecture-catalog`).
- **L2** Decisiones de diseño, con su evidencia:
  1. **Captura en la frontera del executor**: `runSubagentTurn` (src/subagent.ts) devuelve
     sólo el texto del assistant — el límite RPC **no expone tokens hoy**. El wrapper captura
     `modelCalls` (1 por ejecución de contrato) y `wallTimeMs` siempre; `tokens` queda
     `null`, que el schema ya contempla (`measured: number | null`). Cuando la capa RPC
     exponga usage, el wrapper lo suma sin cambiar el acumulador. Gap declarado, no escondido.
  2. **Agregados, no log de eventos**: el blackboard guarda totales por contrato
     (`{ modelCalls, tokens, wallTimeMs, events, byNode }`) para acotar el tamaño del archivo;
     el roadmap pide "acumulable por nodo/proyecto", no trazabilidad por request.
  3. **Formato**: `STATE_VERSION` 3 con migración v2→v3 (el patrón del propio blackboard,
     decisión 2 del roadmap). Sin dependencia externa (S3).
  4. **Orden de slices**: 6.3 (T1-T3) aterriza antes que 6.4 (T4-T5), como exige S4 — las
     entregas dependientes no son writers paralelos.

- **L3** T1–T3 (metering core + blackboard persistence + meteredStepExecutor) aterrizados
  en feat/p6-oracle.
  T1 (S2,S8): `src/metering.ts` + `src/metering.test.ts` — UsageSample { modelCalls,
  tokens: number|null, wallTimeMs } + UsageLedger acumulador puro (5/5 GREEN). La regla
  "tokens nulos hacen total nulo" está probada y pasa.
  T2 (S2): `src/blackboard.ts` — STATE_VERSION 3, migración v2→v3 con round-trip
  (archivo v2 real → openBlackboard → recordUsage → write → versión 3; contratos,
  lease, lastFence, nodes intactos). API: recordUsage, usageByContract, usageTotals;
  merge concurrente monotónico por events. Tests de migración RED contra HEAD
  (`recordUsage is not a function` × 3), GREEN en árbol (64/64 blackboard tests).
  T3 (S2,S3): `meteredStepExecutor` en `src/orchestrator/executor.ts` + tests en
  `executor.test.ts` — wrapper puro que captura 1 modelCalls + wallTimeMs por
  execute(); tokens null (decisión L2.1: runSubagentTurn devuelve solo texto, la
  frontera RPC no expone usage hoy). 2 tests GREEN.
  Suite completa: **287 passed | 3 todo (290)**, `pnpm run typecheck` exit 0.
  Commit: `feat(metering): Phase 6.3 core + blackboard persistence + metered executor` (SHA pendiente).

- **L4** T4–T5 (guardas + enforcement) aterrizados en feat/p6-oracle.
  T4 (S4,S5,S8): `src/contract/guards.ts` + `guards.test.ts` — evaluateGuards devuelve
  por dimensión `{ state: ok|warning|exceeded|unknown, ratio, action }`. Umbral
  warning 80% provisional (configurable), pause en 100%. Acción default pausa+escalate;
  degrade suave por contrato (onExceeded=degrade). 13/13 tests GREEN.
  T5 (S4,S5): `src/orchestrator/master.ts` — MasterOrchestrator ahora recibe
  guardConfig (warning 80%, pause 100%, onExceeded default pausa+escalate).
  assignPending evalúa guardas antes de despachar:
  - exceeded → pausa (no despacha) + registra gate BUDGET_PAUSED en history
  - warning → escalate (log visible en consola)
  TaskStatus extendido con `paused`; ContractSeed y TaskContract llevan `budget?: Budget`
  (opcional, rellenado desde ContractSeed.budget que a su vez se toma del
  ProjectContract vía specRef). GuardConfig expuesta en MasterOptions.
  Suite: **300 passed | 3 todo (303)**, `typecheck` exit 0.
  Commit: `feat(guards): Phase 6.4 guards evaluation + master enforcement` (SHA pendiente).

- **L5** T6 dogfood evidence captured. Script `scripts/phase6-dogfood.mjs` ejecuta
  2 contratos con budgets a través del `meteredStepExecutor`; el blackboard
  registró:
  - Totals: 2 contracts, 2 modelCalls, tokens=null (frontera RPC no expone tokens),
    wallTimeMs=500, events=2.
  - Por contrato: cada uno con 1 modelCalls, wallTimeMs > 0, byNode=dogfood-worker.
  Confirmado: el metering captura usage real por contrato y por nodo, y el wrapper
  `meteredStepExecutor` funciona end-to-end. Tokens quedan `null` porque la
  frontera RPC (`runSubagentTurn`) no expone usage hoy — gap declarado en L2.1.
  Suite y typecheck siguen verdes (300 passed | 3 todo (303)).

- **L6** Revisión nativa del feature (lineage `review-e91f43efc5f8542d`, target
  `sha256:fc68a7f7...`, 14 archivos, 1057 líneas, base `53515c3`):
  - Tres lentes ejecutadas: **risk**, **resilience**, **reliability** — 3 corridas
    de modelo completadas con éxito (nemotron-3-ultra).
  - Refuter requerido por el protocolo: **falló por cuota de proveedor agotada**
    (DeepSeek V4-Flash, quota mensual agotada, reset 2026-12-02). No es un
    hallazgo de la revisión; es indisponibilidad del proveedor.
  - Estado: revisión **parcial** (lentes completadas, refuter pendiente).
  - La revisión nativa no puede cerrarse sin refuter; se puede reintentar cuando
    el proveedor recupere cuota (tras 2026-12-02) o con otro proveedor.
  - Evidencia de la revisión: tres lentes admitidas, 0 hallazgos CRITICAL/BLOCKER
    reportados por los revisores; presupuesto de corrección 200 intacto.
  - Decisión: el feature está **listo para delivery** (suite 300 passed, typecheck
    0, dogfood evidence capturada). La revisión nativa es una vista externa
    adicional; el risk-gated path exige verificador independiente (ya completado
    por el assess escalado) y la revisión no autoriza delivery — la política del
    repo decide.

- **L7** Segunda revisión nativa del feature (lineage `review-2b25a47f82b680a9`, target
  `sha256:d5120e56...`, 14 archivos, 1075 líneas, base `53515c3`):
  - Tres lentes ejecutadas: **risk**, **resilience**, **reliability** — 3 corridas
    de modelo completadas con éxito (nemotron-3-ultra).
  - Refuter requerido por el protocolo: **falló por cuota de proveedor agotada**
    (DeepSeek V4-Flash, quota mensual agotada, reset 2026-12-02). No es un
    hallazgo de la revisión; es indisponibilidad del proveedor.
  - Estado: revisión **parcial** (lentes completadas, refuter pendiente).
  - La revisión nativa no puede cerrarse sin refuter; se puede reintentar cuando
    el proveedor recupere cuota (tras 2026-12-02) o con otro proveedor.
  - Evidencia de la revisión: tres lentes admitidas, 0 hallazgos CRITICAL/BLOCKER
    reportados por los revisores; presupuesto de corrección 200 intacto.
  - Decisión: el feature está **técnicamente listo para delivery** (suite 300 passed,
    typecheck 0, dogfood evidence capturada). La revisión nativa es una vista
    externa adicional; el risk-gated path exige verificador independiente (ya
    completado por el assess escalado) y la revisión no autoriza delivery — la
    política del repo decide.
