# Manual de Usuario — gentle-cowork

**Versión:** 1.2.2 | **Fecha:** 2026-11-12 | **Compatibilidad:** Pi / gentle-shell ≥ 1.5.0

---

## 📋 Tabla de Contenidos

1. [Introducción](#introducción)
2. [Instalación Rápida](#instalación-rápida)
3. [Comandos Disponibles](#comandos-disponibles)
4. [Flujo de Trabajo ODD](#flujo-de-trabajo-odd)
5. [Los Tres Roles](#los-tres-roles)
6. [Multi-Nodo (Dogfooding)](#multi-nodo-dogfooding)
7. [Seguridad Zero-Trust](#seguridad-zero-trust)
8. [Verificación Nativa](#verificación-nativa)
9. [Solución de Problemas](#solución-de-problemas)

---

## Introducción

**gentle-cowork** es una extensión de orquestación multi-rol para **Pi / gentle-shell** que convierte las decisiones de delegación de **Organic Driven Development (ODD)** en un flujo de trabajo estructurado, verificado y multi-rol — sin convertirse nunca en un framework SDD silencioso.

### ¿Qué hace diferente a gentle-cowork?

| Principio | Descripción |
|---|---|
| **Nunca por tamaño** | La delegación se activa solo por razones nombradas: paralelismo real, verificación independiente, context backstop |
| **Spec by reference** | Los subagentes reciben la ruta al documento ODD, nunca un resumen parafraseado |
| **Contratos ligeros** | Cada delegación lleva un `TaskContract` — sin documentos formales de propuesta/spec/design |
| **Árbol plano** | Los subagentes nunca engendran sub-subagentes |
| **Invisible a ODD** | El usuario describe lo que necesita; la extensión enruta naturalmente |

### Requisitos Previos

- **Node.js ≥ 24** (ESM puro)
- **pnpm** (o npm) como gestor de paquetes
- **Pi / gentle-shell ≥ 1.5.0** — esto es una extensión, no una herramienta standalone
- **Git**

---

## Instalación Rápida

```bash
# 1. Clonar e instalar dependencias
git clone https://github.com/ipproyectosysoluciones/gentle-cowork.git
cd gentle-cowork
pnpm install

# 2. Configurar claves API / modelos
cp .env.example .env
# Editar .env con tus claves:
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# NVIDIA_API_KEY=nvapi-...
# OLLAMA_BASE_URL=http://localhost:11434

# 3. Verificación obligatoria — ambos gates deben estar en verde
npx tsc --noEmit      # TypeScript estricto, cero errores
npx vitest run        # 321 tests pasan

# 4. Cargar en tu sesión Pi
pi -e ./src/gentle-cowork.ts
```

**Instalación permanente** (opcional):
```bash
cp src/gentle-cowork.ts ~/.pi/agent/extensions/gentle-cowork.ts
```

---

## Comandos Disponibles

La extensión registra **5 comandos** en la sesión Pi:

| Comando | Descripción | Fase |
|---|---|---|
| `/cowork` | Muestra estado de orquestación (último contrato, rol, estado) | 0 |
| `/cowork-contract` | Muestra el último TaskContract como JSON | 0 |
| `/cowork-verify` | Engendra subagente cowork-verifier (test Fase 1) | 1 |
| `/cowork-chain` | Ejecuta cadena completa planner → implementer → verifier | 2 |
| `/cowork-dogfood` | Ejecuta dogfooding nativo via Pi background jobs | 5 |

### Subcomandos de Dogfood

```bash
/cowork-dogfood run [--timeout 300]      # Master + worker via bash_background (default 300s)
/cowork-dogfood master --shared-dir PATH # Solo master
/cowork-dogfood worker --shared-dir PATH # Solo worker
/cowork-dogfood help                     # Muestra ayuda
```

---

## Flujo de Trabajo ODD

### Spec by Reference
Cada delegación lleva un `specRef` apuntando a un documento de tarea ODD bajo `odd/tasks/<feature>.md`:

```
odd/tasks/<feature>.md
├── ## Specs (S1, S2, S3...) — requisitos numerados citando palabras exactas del usuario
├── ## Tasks (T1, T2, T3...) — una línea por tarea: ID, S# vinculado, ruta, commit
└── ## Log (L1, L2, L3...) — petición original verbatim + correcciones, evidencia, decisiones
```

### Triggers de Delegación (solo razones nombradas)
El hook `tool_call` intercepta delegaciones **solo cuando ODD ya clasificó una razón válida**:

1. **Paralelismo real** — 2+ unidades de trabajo independientes (~100+ líneas cada una, lanzadas juntas)
2. **Verificación independiente** — Item de alto riesgo requiriendo `gentle-ai-verify` (datos, seguridad, contratos, concurrencia, delivery, no-net)
3. **Context backstop** — Sesión alcanzó ~150k tokens, delega la siguiente unidad

**Sin razón nombrada** (`reason` field en input de la tool), la delegación nativa procede **sin intercepción**.

### Persistencia de Contratos (Fase 4)
Cada transición de `TaskContract` se persiste en el blackboard compartido (`.gentle-cowork/blackboard.json`):
- JSON atómico con file locking (`.lock` + sufijo aleatorio)
- Contador de versión para concurrencia optimista
- Lease/fence con tokens criptográficos (`generateFence`)
- Sobrevive reinicios de daemon (`session_start` recarga)

---

## Los Tres Roles

| Rol | Permiso | Responsabilidad |
|---|---|---|
| 🧠 **cowork-planner** | read-only | Descompone el objetivo en plan con scope y criterios de aceptación |
| 🔨 **cowork-implementer** | scoped write | Ejecuta un paso del plan; produce resumen de artefacto |
| ✅ **cowork-verifier** | read + tests | Valida cambios por requisito ODD (S#) via **review nativo de gentle-shell** (`review.start`/`review.finalize`, lenses `review-readability` + `review-reliability`); emite `APPROVE` o `CHANGES` |

**La inteligencia queda del lado del agente.** El bridge/extensión solo enruta — cada delegación envía un prompt pre-elaborado al asistente, que usa sus tools nativas.

### Cadena de Ejecución (Fase 2)

```
Planner → Implementer → Verifier
   ↓           ↓           ↓
  plan      artifact    verdict per S#
                              ↓
                        APPROVE → siguiente paso
                        CHANGES → retry (max 3)
```

---

## Multi-Nodo (Dogfooding)

### Local (Fase 5 — Completado)

Dos sesiones Pi en la misma máquina coordinan via blackboard compartido:

```bash
# Terminal 1: Master
npm run dogfood:master -- --shared-dir /tmp/cowork-shared

# Terminal 2: Worker (en otra sesión Pi)
npm run dogfood:worker -- --shared-dir /tmp/cowork-shared

# O ambos via native background jobs (comando único)
npm run dogfood:run
```

### Remoto (Fase 5 — En Progreso)

Ejecuta un worker en VPS remoto (container Docker sobre túnel SSH reverso):

```bash
npm run worker:remote -- --host <vps-host> --user <vps-user> \
  [--key <ssh-key-path>] --token <allowlist-token> \
  --env OPENAI_API_KEY=... --expected-node <worker-node-id>
```

El launcher aprovisiona el VPS (instala Docker, escribe `/etc/gentle-cowork/worker.env` modo 0600, inicia container worker con `--restart unless-stopped`), abre túnel SSH reverso al puerto WS del master, y verifica el registro del worker en el blackboard.

---

## Seguridad Zero-Trust (T5.7)

El transporte multi-nodo incluye capa zero-trust:

| Capa | Característica | Estado |
|---|---|---|
| **C1** | mTLS con certificados x509 | ✅ |
| **C3** | Límites de tamaño de mensaje | ✅ |
| **C5** | Límite de profundidad JSON | ✅ |
| **C6** | Config TLS wss:// | ✅ |
| **C7** | Rate limiting | ✅ |
| **C9** | Límites longitud texto inbound | ✅ |
| **L1** | Headers de seguridad en Admin API | ✅ |
| **L2** | Audit log para acciones mutantes admin | ✅ |
| **L3** | Ping/pong a nivel aplicación | ✅ |
| **M1** | Rate limiting endpoints mutantes admin | ✅ |
| **M3** | Límites explícitos longitud mensaje inbound | ✅ |

Endpoints Admin API (mutantes): `/api/admin/allowlist`, `/api/admin/pair/start`, `/api/admin/pair/regenerate`, `/api/admin/pair/cancel`, `/api/admin/verify`, `/api/admin/unpair`

---

## Verificación Nativa

El `cowork-verifier` usa **integración nativa de review de gentle-shell**:

```
review.start → lenses: review-readability (S1) + review-reliability (S2)
     ↓
captureResult (evidencia por S#)
     ↓
acknowledgeApproved → authority burned
```

- **Veredicto por S#:** `pass` / `fail` / `untested`
- **Outcome:** `APPROVE` o `CHANGES` (dispara retry loop, máx 3)
- **Integración:** `runNativeVerify()` en `src/verifier.ts`

---

## Solución de Problemas

### Tests no pasan
```bash
# Verificar TypeScript
npx tsc --noEmit

# Verificar tests específicos
npx vitest run src/zero-trust/role-permissions.test.ts
npx vitest run src/verifier.test.ts
```

### WebSocket connection refused
- Verificar que el servidor está corriendo en puerto 4322 (TEST_PORT)
- Verificar certificado CA en `ca.pem`
- Verificar variable de entorno `TEST_PORT`

### Subagente no responde
- Verificar `READINESS_ATTEMPTS=15` y `READINESS_DELAY_MS=2000` en `src/subagent.ts`
- Verificar `VERIFY_TIMEOUT_MS=300000` y `CHAIN_TIMEOUT_MS=900000`
- Verificar que `promptAndWait` recibe timeout como 3er argumento

### Rate limiting en Admin API
- Límite: 60 req/min por IP (token bucket)
- Headers de seguridad siempre presentes: `x-content-type-options: nosniff`, `x-frame-options: DENY`, `content-security-policy: default-src 'none'; frame-ancestors 'none'`

---

## Enlaces Útiles

- **Repo:** https://github.com/ipproyectosysoluciones/gentle-cowork
- **Roadmap:** [ROADMAP.md](../ROADMAP.md)
- **Contribuyendo:** [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md)
- **CHANGELOG:** [CHANGELOG.md](../CHANGELOG.md)
- **Gentle-AI:** https://github.com/Gentleman-Programming/gentle-ai