# 🏗️ gentle-cowork — Extensión de Orquestación para Pi/gentle-shell

> Una extensión de Pi que convierte la delegación aprobada por ODD en un flujo de trabajo estructurado, verificado y multi-rol. Delega por razón nombrada, nunca por tamaño.

---

## 🎯 El Problema Que Resuelve

Cuando trabajas con agentes de IA en proyectos complejos, la delegación suele ser una caja negra:

- El agente hace TODOS los cambios él mismo — sin verificación independiente
- Sin especialización — un solo agente planifica, codifica y revisa
- Sin transparencia — no sabes qué archivos se tocaron ni por qué
- Sin fallback — si el agente falla, empiezas de cero

**gentle-cowork** resuelve esto agregando una capa de roles de subagente especializados que ODD (Organic Driven Development) activa cuando el trabajo genuinamente necesita delegación.

---

## 🧠 Los Tres Roles Especializados

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   🧠 PLANIFICADOR ──→ 🔨 IMPLEMENTADOR ──→ ✅ VERIFICADOR│
│   (solo lectura)      (escritura acotada)  (lectura+tests)│
│                                                         │
│   Descompone          Ejecuta UN          Valida         │
│   el objetivo         paso dentro         cambios por    │
│   en un plan          de su alcance       requisito S#   │
│                                                         │
│   Devuelve:           Devuelve:           Devuelve:      │
│   • Plan (JSON)       • Resumen de        • Veredicto    │
│   • Alcance             cambios           • Evidencia    │
│   • Criterios          • Archivos         • Por S#       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### cowork-planner
- **Acceso:** `read`, `grep`, `find`, `ls` — solo lectura
- **Función:** Lee el spec de ODD por referencia, descompone el objetivo en pasos independientemente verificables
- **Salida:** Un plan JSON con pasos, alcance de archivos y criterios de aceptación

### cowork-implementer
- **Acceso:** `read`, `write`, `edit` — escritura acotada
- **Función:** Ejecuta UN paso del plan, tocando solo archivos dentro de su alcance permitido
- **Salida:** Un resumen de artefacto (archivos modificados, cambios realizados, notas)

### cowork-verifier
- **Acceso:** `read`, `bash` (solo ejecución de tests) — lectura + pruebas
- **Función:** Valida los cambios contra el spec de ODD, requisito por requisito (S#)
- **Salida:** Un veredicto estructurado — `APPROVE` (todos pasan) o `CHANGES` (alguno falla, con detalles)

---

## 🔄 El Flujo de Trabajo

```
Usuario: "Necesito X"
       │
       ▼
┌─ ODD clasifica ─────────────────────────────────┐
│  ¿Es pequeño y entendido? → Resolver en línea   │
│  ¿Necesita delegación? → ¿Razón nombrada?       │
│    (paralelismo, verificación independiente,    │
│     context backstop)                           │
└─────────────────────────────────────────────────┘
       │ Sí — existe una razón nombrada
       ▼
┌─ gentle-cowork se activa ───────────────────────┐
│                                                 │
│  1. Planificador lee el spec → devuelve plan    │
│  2. Implementador ejecuta paso → artefacto      │
│  3. Verificador valida → veredicto              │
│     ├── APPROVE → siguiente paso                │
│     └── CHANGES → reintentar (máximo 3)         │
│                                                 │
└─────────────────────────────────────────────────┘
       │
       ▼
  Commit con evidencia
```

---

## 📋 El Contrato de Tarea (TaskContract)

Cada delegación lleva un contrato ligero — **no** es un artefacto SDD:

```typescript
interface TaskContract {
  id: string;                    // identificador único
  objective: string;             // qué hay que hacer
  role: CoworkRole;              // planner | implementer | verifier
  scope: string[];               // archivos/directorios permitidos
  acceptanceCriteria: string[];  // definición de "completado"
  specRef: string;               // ruta al spec de ODD (POR REFERENCIA)
  artifacts: string[];           // resultados producidos
  status: TaskStatus;            // pending | in_progress | completed | failed
}
```

**Decisión clave de diseño:** El campo `specRef` apunta al documento de características de ODD (`odd/tasks/<feature>.md`). Los subagentes leen el spec **por referencia** — nunca un resumen parafraseado. Esto preserva la fidelidad de los requisitos (según PR #1718 de gentle-shell).

---

## 🛡️ Cuándo el Orquestador Delega

El orquestador (Pi/gentle-shell) delega a gentle-cowork **solo cuando existe una razón nombrada**:

| Razón Nombrada | Ejemplo |
|---|---|
| **Paralelismo real** | Dos módulos independientes pueden construirse simultáneamente |
| **Verificación independiente** | El trabajo del implementador necesita un revisor separado |
| **Context backstop** | El contexto del agente principal está creciendo; delegar a un subagente fresco |
| **Especialización** | La tarea requiere un conjunto de herramientas específico |

### Cuándo NO delega:

- Trabajo pequeño y entendido → ODD lo maneja en línea
- Cambios de un solo archivo → en línea
- Sin razón clara → aunque la tarea "parezca grande"
- Objetivos inciertos → preguntar al usuario primero

---

## 🚫 Lo que gentle-cowork NO es

- **NO es un SDD silencioso** — sin artefactos formales de propuesta/spec/diseño
- **NO es un sistema de sprints** — activación por umbral de complejidad, no por calendario
- **NO es un fork** — es una extensión usando el mecanismo de extensiones de Pi
- **NO reemplaza la revisión de gentle-ai** — el verificador INVITA a la autoridad de revisión de gentle-ai, nunca la sustituye

---

## 📊 Estado Actual

| Fase | Estado | Completado |
|---|---|---|
| Fase 0 — Esqueleto | ✅ Completa | Estructura, tipos, entrada de extensión, agentes, skill |
| Fase 1 — Verificación de un rol | ✅ Completa | Subagente verificador genera y devuelve veredictos |
| Fase 2 — Cadena completa | 🔄 En Progreso | Ciclo Planificador → Implementador → Verificador con tests |
| Fase 3 — ODD invisible | 📋 Pendiente | Hook tool_call para delegación natural |
| Fase 4 — Estado compartido | 📋 Pendiente | Persistencia de orquestación (Blackboard) |
| Fase 5 — Multi-nodo | 🔮 Futuro | Arquitectura Master/Worker en VPS |

---

## 🤝 Cómo Contribuir

El proyecto es open source (MIT). Áreas donde se agradece ayuda:

- Probar la lógica del verificador con proyectos reales
- Diseñar roles adicionales (ej: `cowork-documenter`)
- Construir el sistema de estado Blackboard
- Protocolos de comunicación multi-nodo

---

*Construido con ❤️ como parte del ecosistema Gentle — ODD por defecto, delegación por diseño.*
