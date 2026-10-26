# Phase 6 · Slice 6.1 — ProjectContract schema (workflow doc)

> **Estado: BORRADOR PARA REVISIÓN DEL DUEÑO.** Ningún código hasta la aprobación (S4).
> El ejemplo fundacional no es genérico: es el contrato retrospectivo del T8, con los
> datos reales de la semana del provider storm (S2).

## 1. El problema que resuelve

La Phase 5 dio el substrato de ejecución (blackboard multinode, orquestador
master-worker, ciclo RDD). Lo que falta es la **capa de negocio**: un desarrollo
empresarial se asume con un contrato que define restricciones, y hoy no existe un
artefacto que lo declare de forma máquina-evaluable. Sin él, el oráculo (metering)
no sabe *contra qué* medir, las guardas no saben *cuándo* frenar, y los reportes no
saben *qué* prometer al negocio.

## 2. Diseño del schema (v1)

JSON Schema versionado, almacenado en el blackboard con las primitivas de la T5.1
(locking + version counter + orphan recovery). El patrón es el de los archivos de
config del daemon: fail-closed en la carga (un contrato inválido no arranca
ejecución), escritura atómica 0600, nunca contiene secretos.

```jsonc
{
  "schema": "gentle-cowork.projectcontract/v1",
  "id": "dot-whatsapp-admin-api",            // estable, slug
  "title": "Admin API local para el panel Channels (T8)",
  "objective": "Que el panel Channels de gentle-dot opere el bridge sin shell",
  "branch": "main",
  "deliverables": [                           // entregables con aceptación
    {
      "id": "D1",
      "title": "Admin API según S6 (status/allowlist/pair/verify/unpair)",
      "specRef": "odd/tasks/dot-whatsapp.md#S6",
      "acceptance": [
        { "kind": "tests",     "assert": "51/51 green; 29 pre-existing unmodified" },
        { "kind": "typecheck", "assert": "tsc --noEmit clean" },
        { "kind": "e2e-live",  "assert": "GET /status + /allowlist + circuito WS responden" }
      ],
      "status": "delivered"
    }
  ],
  "scopeClauses": [                           // cláusulas de scope
    {
      "id": "SC1",
      "rule": "Additive-only: el relay Baileys queda behaviorally idéntico",
      "enforcement": "existing-tests-unmodified"
    },
    {
      "id": "SC2",
      "rule": "El número completo nunca cruza el daemon ni la UI (últimos 4)",
      "enforcement": "contract-tests"
    }
  ],
  "deadlines": { "soft": null, "hard": null },   // plazos (opcionales en v1)
  "qualityMetrics": [                            // métricas de calidad medibles
    { "metric": "test-count",   "target": ">= 51", "measured": 51 },
    { "metric": "typecheck",    "target": "clean", "measured": "clean" }
  ],
  "budget": {                                    // presupuesto (tokens/llamadas/tiempo)
    "modelCalls": { "limit": null, "measured": null },   // se llena con 6.3
    "tokens":     { "limit": null, "measured": null },
    "wallTime":   { "limit": null, "measured": null }
  },
  "gates": [                                     // puertas de aprobación
    { "id": "G1", "kind": "user-decision",  "appliesTo": "arquitectura", "state": "passed",
      "evidence": "'externo ahora, hijo después' (2026-10-23)" },
    { "id": "G2", "kind": "slice-boundary", "appliesTo": "~400 líneas",  "state": "passed",
      "evidence": "boundary registrado en L6 del doc hermano" },
    { "id": "G3", "kind": "native-review",  "appliesTo": "unidad T8",     "state": "paused",
      "evidence": "lineage review-b9b28abce22be44e; provider storm" },
    { "id": "G4", "kind": "publish",        "appliesTo": "push/PR",       "state": "passed",
      "evidence": "push + PR por orden del dueño" }
  ],
  "meta": {
    "commits": ["ac95a26", "67e82ca", "45b8f26"],
    "reviewLineage": "review-b9b28abce22be44e",
    "issueRef": "gentle-dot#65"
  }
}
```

### Decisiones de diseño (para tu OK)

1. **`acceptance[].kind` es un enum cerrado** (`tests | typecheck | e2e-live |
   lint | manual`): el validador (7.4) y el reporte (6.5) solo entienden estos
   tipos — extender el enum es migración, no parche.
2. **`gates[].kind` refleja las puertas REALES que vivió el T8** (decisión del
   dueño, slice boundary ~400, revisión nativa, publish): el schema modela la
   gobernanza que efectivamente se practicó, no una idealizada.
3. **`budget` nulo en v1**: se declara la estructura ahora (6.1) pero se *mide* en
   6.3 y se *guarda* en 6.4 — calibrar umbrales con datos reales antes de frenar.
4. **Migración**: `schema` lleva versión; el store aplica up-migrations
   encadenadas (v1→v2→…) con tests por migración, igual que el patrón del
   blackboard. Un contrato de versión desconocida falla cerrado.
5. **Enmiendas = versión nueva**: cambiar un contrato vivo produce `vN+1` con
   changelog; el historial queda en el blackboard (nada de edits silenciosos).

## 3. El contrato retrospectivo del T8 — el ejemplo fundacional, con los datos reales

### Entregables y aceptación (como se vivió)

| Entregable | Aceptación | Resultado |
|---|---|---|
| Admin API S6 (8 endpoints, token 0600 re-leído por request, masking server-side) | Suite + typecheck + contract tests de masking | ✅ 51/51 (29 intactos + 22 nuevos) |
| Eventos `onState` + tracker off/pairing/connected/error | Tests offline del tracker | ✅ |
| Base del panel Channels (doc hermana gentle-dot) | GT1-GT4: protocol 39/39, proxy 7/7, UI 10/10, tsc -b | ✅ |
| E2E en vivo | `GET /status` → `connected …5298`; circuito WS → 3 payloads correctos | ✅ 25/oct |

### El costo real — la semana del provider storm

| Evento | Costo medido |
|---|---|
| Subagentes stall ×2 (explorador + writer, sin primer evento del modelo) | Re-planning a inline; fallback documentado |
| Captura de revisión 502 ×2 | ~5 min de wall-time cada una, 0 revisores |
| Captura por output-budget (stopReason: length, lente reliability) | ~36 min de wall-time |
| Stop `managed_assets_outdated` + sync prescrito | 1 ciclo extra |
| Rebase sobre corrección remota del LICENSE (1a8e078) | 1 conflicto resuelto, suite re-corrida |

**La enseñanza que el contrato captura**: la aceptación (51/51) NO cambió por el
storm; lo que cambió fue el costo de las puertas (la revisión nativa acumuló 3
intentos). Un ProjectContract hubiese hecho visible ese desvío en el momento —
el reporte (6.5) lo habría mostrado como "gate G3: 3 intentos, pausado" en vez
de descubrirlo al cierre.

### Las puertas, tal como operaron

| Puerta | Momento | Estado final |
|---|---|---|
| Decisión de arquitectura (externo ahora / hijo después) | 23/oct, ask_user | passed |
| Slice boundary ~400 líneas (harness lo exigió) | 25/oct, L6 registrado | passed |
| Revisión nativa (RDD on, medium tier) | 25/oct, 3 intentos | **paused** (open lineage) |
| Publish (push + PR) | 25/oct, por orden explícita | passed |

## 4. El workflow (quién hace qué, en qué orden)

```
ROADMAP slice  →  orquestador redacta el contrato (draft, vN)
              →  REVISIÓN DEL DUEÑO            ← puerta G-user
              →  status:approved (vN firmado)
              →  store en blackboard (versioned, atomic)
              →  6.2 interpreta → TaskContracts + gates evaluables
              →  6.3 mide usage por contrato (wrapper del executor)
              →  6.4 guarda: acercarse al límite → pausa/escalado (default)
              →  6.5 reporta al negocio desde blackboard+contrato
Enmienda      →  nueva versión vN+1 con changelog (nunca edit silencioso)
```

## 5. Fuera de alcance de 6.1 (explícito)

- Evaluación de gates en runtime (6.2), metering (6.3), guardas activas (6.4),
  reportes (6.5), dogfooding (6.6).
- Presupuestos con valores (solo estructura).
- i18n de reportes; formatos business (6.5).

## 6. Plan TDD (después de tu aprobación)

1. RED: schema validation tests (válido/inválido por campo, enum cerrado, fail-closed en versión desconocida).
2. GREEN: `src/contract/schema.ts` (tipos + validate + migración v1; fixture = el T8).
3. RED/GREEN: `src/contract/store.ts` (blackboard versioned store; locking/fencing vía primitivas T5.1; fixture round-trip).
4. Refactor + auditoría de cobertura del gate + revisión nativa por unidad (S6).
