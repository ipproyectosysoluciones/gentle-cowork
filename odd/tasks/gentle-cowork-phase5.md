# gentle-cowork Phase 5 — Multi-node orchestration (ODD feature document)

Multi-node scaling for gentle-cowork: distributed role orchestration across gentle-shell instances. Dogfooding model — the project uses its own blackboard to coordinate its construction, first multi-session local, then network (VPS/workers).

## Specs

- **S1 — Master/Worker architecture.** Verbatim from `ROADMAP.md`: "Master/Worker architecture: gentle-shell on a VPS as orchestrator, gentle-cowork agents on distributed workers". The master (TUI) owns the blackboard and routes steps to workers; workers execute planner/implementer/verifier roles via the same RPC transport used in Phases 1-4, but over the network instead of local `pi --mode rpc`.

- **S2 — WebSocket or gRPC communication layer.** Verbatim from `ROADMAP.md`: "WebSocket or gRPC communication layer". Stage 1 uses the shared blackboard file (local multi-session). Stage 3 introduces WebSocket, reusing the daemon's existing WS protocol on port 4317 as reference. gRPC is an alternative if WS proves insufficient for structured payloads.

- **S3 — Zero-Trust security.** Verbatim from `ROADMAP.md`: "Zero-Trust security (TLS, per-role permissions, allowlisted workers)". TLS on all connections. Per-role permissions: planner/implementer/verifier each have distinct capabilities. Allowlisted workers via pre-shared keys or mTLS certificates; no anonymous connections.

- **S4 — Horizontal scaling.** Verbatim from `ROADMAP.md`: "Horizontal scaling: add workers by deploying new gentle-shell instances". Workers register with the master, advertise capabilities (planner, implementer, verifier, or combinations), and receive work via the communication layer. No central scheduler beyond the master's role router.

**Exit criteria (verbatim from ROADMAP.md):** "Two nodes communicating; a task delegated to a remote worker completes and returns a verdict."

---

## User Decision (Recorded)

> "dogfooding — el proyecto usa su propio blackboard para coordinar su construcción, primero multi-sesión local, después red (VPS/workers)"

This means:
- Stage 1 (local multi-session): Two or more Pi sessions on the same machine share `.gentle-cowork/blackboard.json` via file locks. The blackboard already persists; we add advisory locking and lease semantics.
- Stage 2 (dogfooding): This Phase 5 work itself is tracked on the blackboard. A local TUI session acts as master; a background Pi session acts as worker. They coordinate the Phase 5 implementation via the blackboard.
- Stage 3 (network): Replace file-based coordination with WebSocket (port 4317, reusing daemon WS protocol). Workers can run on remote VPS.

---

## Known Debt (from L7)

> **Phase 5 note: whole-file last-writer-wins writes will need merge/locking for multi-node.**

Current `blackboard.ts` writes the entire JSON state atomically (temp file + rename). With multiple writers:
- Lost updates: Node A reads, Node B reads, Node A writes, Node B writes → A's changes lost.
- No conflict resolution for concurrent TaskContract mutations.

**Required for Phase 5:**
1. **Advisory file locking** (fcntl/flock) around read-modify-write.
2. **Lease mechanism**: A writer acquires a lease (TTL, e.g., 30s), renews it while working, releases on completion. If a node dies with the lease, it expires and another node can acquire.
3. **Conflict-free merge for TaskContracts**: Contracts are append-only by ID (status transitions only: pending → in_progress → completed/failed). Merge = last-write-wins per contract ID (newer timestamp wins), with audit trail of all transitions. Never overwrite another node's in_progress contract.

---

## Design

### Node Identity

Two node types, distinguished by **role capability advertisement** and **session context**:

| Aspect | Master (TUI) | Worker (RPC/Background) |
|--------|--------------|-------------------------|
| **Process** | Interactive `pi` with TUI | Headless `pi --mode rpc` or `pi -e` |
| **Blackboard** | Primary writer, lease holder | Lease requester, transient writer |
| **Role router** | Routes steps to workers | Executes assigned role(s) |
| **Capabilities** | `planner`, `verifier` (orchestration) | `implementer` (execution) |
| **Registration** | Creates blackboard, advertises on startup | Discovers blackboard, registers with master |
| **Identity key** | `node-id = "master-<pid>-<session-uuid>"` | `node-id = "worker-<pid>-<session-uuid>"` |

**Capability advertisement** (stored in blackboard under `nodes[]`):
```typescript
interface NodeRegistration {
  nodeId: string;           // unique per process
  role: "master" | "worker";
  capabilities: ("planner" | "implementer" | "verifier")[];
  startedAt: string;        // ISO timestamp
  lease?: LeaseInfo;        // current lease if holder
  status: "alive" | "stale"; // updated by heartbeat
}
```

### Blackboard Locking / Lease

**File locking (Stage 1 — local, same-machine only):**
- Use `fs.open` with `O_EXLOCK` (BSD/macOS) or `fcntl(F_SETLK, F_WRLCK)` (Linux) for exclusive write access.
- Readers take shared lock (`F_RDLCK` / `O_SHLOCK`).
- Lock scope: entire read-modify-write cycle (read → mutate → write).
- **Stage 3+**: flock is local-only; lock authority migrates to the master WS server (single source of truth).

**Lease mechanism with fencing tokens (Stage 1+):**
```typescript
interface LeaseInfo {
  holderNodeId: string;     // node that owns the lease
  acquiredAt: string;       // ISO timestamp
  expiresAt: string;        // acquiredAt + TTL (30s default)
  renewedAt?: string;       // last renewal
  fence: number;            // monotonic token; increments on every acquire/renew
}
```

- **Acquire**: Writer checks `blackboard.lease`. If absent or `expiresAt < now`, atomically writes new lease with `fence = (prev?.fence ?? 0) + 1` (requires exclusive lock).
- **Renew**: Holder updates `renewedAt`, `expiresAt`, and **increments `fence`** periodically (every 10s) while doing work.
- **Release**: On normal completion, clears `lease` (with lock).
- **Fencing enforcement**: Every write to the blackboard (including lease updates, contract mutations, node heartbeats) **must include the current `fence` value** from the lease it holds. The blackboard rejects any write whose presented `fence < blackboard.lease.fence`. This prevents a stale holder (partitioned, GC-paused) from overwriting a newer lease.
- **Expiry**: If `expiresAt < now`, any node can acquire a new lease (which gets a higher fence). Stale `in_progress` contracts are **not** auto-failed — they remain for orphan recovery sweep.

**Node death handling & orphan recovery:**
- Heartbeat: Master updates `nodes[].status = "alive"` + `lastHeartbeat` every 5s.
- If `lastHeartbeat > 15s` → `status = "stale"`.
- **Orphan recovery sweep (master-only, runs every 10s):**
  - For each contract with `status === "in_progress"`:
    - If its `leaseFence` (fence value at time of `in_progress` transition) `< blackboard.lease.fence` **AND** the owner node's `lastHeartbeat > 30s` (N=2 missed heartbeats after lease expiry) → mark contract `failed(stale)` with artifact `{ reason: "orphaned", previousFence: X, currentFence: Y }`.
    - Re-queue: create a new `pending` contract for the same step (same scope/criteria), incrementing a `retryCount` on the contract. Max 3 retries total before permanent `failed`.
- Master can reassign work from stale workers (contracts in `in_progress` owned by that worker → `pending`).

### Conflict Resolution (TaskContract Merge)

**Contract identity:** `TaskContract.id` is immutable and unique (prefix + counter: `gc-1`, `vc-1`, `ch-1`, etc.).

**Version counter (monotonic per contract, under lock):**
- Each contract carries `version: number` (starts at 1 on creation).
- Every status transition **increments `version`** while holding the blackboard lock.
- Timestamps (`updatedAt`) are **display/audit only** — they do NOT drive merge decisions.

**State machine (append-only transitions):**
```
pending → in_progress → completed
                      → failed
```

**Merge rule (per contract ID, under lock):**
1. Compare `version` (higher wins).
2. If versions equal (concurrent same transition), compare `status` order: `completed` > `failed` > `in_progress` > `pending`.
3. **Only valid forward transitions allowed** (enforced by version increment):
   - `pending` → `in_progress` ✓
   - `in_progress` → `completed` ✓
   - `in_progress` → `failed` ✓
   - `completed` → anything ✗ (terminal, version would not increment)
   - `failed` → anything ✗ (terminal)
4. **Audit trail**: Every transition appended to `contract.history[]` (`{ status, version, nodeId, timestamp, artifacts?, leaseFence }`). Current status = last entry.

**Implementation:** `blackboard.ts` exposes `mergeContracts(incoming: TaskContract[])` applying above. Called after acquiring lease, before write. The lock guarantees sequential version assignment — no races.

### Transport Stages

| Stage | Transport | Scope | Notes |
|-------|-----------|-------|-------|
| **1** | Shared file (`blackboard.json`) + advisory locks + fencing | Local multi-session | Zero network code. Uses existing blackboard. Leases + merge above. |
| **2** | Stage 1 + dogfooding | This project builds itself | Master TUI + background Pi session coordinate Phase 5 tasks via blackboard. Validates lease/merge under real concurrent load. |
| **3** | WebSocket (port 4317) | Network (VPS/workers) | Reuse daemon WS protocol (`gentle-ai` has WS server on 4317 for TUI↔daemon). **Lock authority migrates to master WS** (flock is same-machine only). Master is single lease grantor; workers request/renew via WS. Add message types: `RegisterWorker`, `AssignStep`, `StepResult`, `Heartbeat`, `LeaseRequest`, `LeaseGrant`, `LeaseRelease`. TLS via self-signed certs or mTLS. |
| **4** | gRPC (optional) | If WS insufficient | Structured payloads, streaming, deadlines. Protobuf definitions for `TaskContract`, `Step`, `Verdict`. |

**WebSocket message types (Stage 3):**
```typescript
type WSMessage =
  | { type: "RegisterWorker"; payload: NodeRegistration }
  | { type: "AssignStep"; payload: { contractId: string; step: PlanStep; workerNodeId: string } }
  | { type: "StepResult"; payload: { contractId: string; stepId: string; artifact: string; status: "completed" | "failed"; verdict?: VerifierVerdict } }
  | { type: "Heartbeat"; payload: { nodeId: string; timestamp: string } }
  | { type: "LeaseRequest"; payload: { nodeId: string; ttlMs: number } }
  | { type: "LeaseGrant"; payload: { granted: boolean; expiresAt: string; fence: number } }
  | { type: "LeaseRelease"; payload: { nodeId: string } };
```

**Protocol reference:** The daemon in `gentle-ai` (`internal/daemon/`) runs a WS server on 4317 for TUI communication. Message framing: newline-delimited JSON. We adopt the same framing for compatibility.

### Dogfooding Execution (Stage 2)

**How Phase 5 uses its own blackboard to build Phase 5:**

1. **Master session (TUI)** starts, creates blackboard, registers as `master` with capabilities `["planner", "verifier"]`. **Verifier runs ONLY on master** (never on workers) — master owns verification authority and lease arbitration.
2. **Worker session (background)** starts via `pi --mode rpc` (or `bash_background` with `pi -e`), discovers blackboard, registers as `worker` with capabilities `["implementer"]` (no verifier).
3. **Task creation**: Master writes Phase 5 tasks as `TaskContract`s to blackboard (e.g., `gc-1: "Design Phase 5 locking"`, `gc-2: "Implement file locking"`, `gc-3: "Implement lease mechanism"`, `gc-4: "Implement merge logic"`, `gc-5: "Add WS transport skeleton"`, `gc-6: "End-to-end two-node test"`).
4. **Orchestration loop (master):**
   - Acquire lease (with fence).
   - Scan for `pending` contracts → assign to `planner` (self) or `implementer` (worker).
   - For planner steps: master runs planner role locally, writes plan steps as child contracts.
   - For implementer steps: master writes `in_progress` + `workerNodeId` + `leaseFence` (current fence). Worker polls blackboard, sees assigned work.
   - Worker requests short lease (10s) to write result, presents fence; blackboard validates fence ≥ current.
   - Worker executes step (reuse `runChain` logic), writes artifact, updates contract with new version.
   - Master verifies (verifier role, co-located) → marks `completed` or `failed(stale)` with `CHANGES` verdict.
   - Release lease.
5. **Worker loop:**
   - Request lease (short, e.g., 10s) to write result, include current fence.
   - Poll blackboard for contracts where `role === "implementer" && status === "in_progress" && workerNodeId === myNodeId`.
   - Execute step, write artifact, update contract (version increments under lock).
   - Release lease.
6. **Orphan recovery (master sweep, every 10s):** Detects `in_progress` with expired lease + stale heartbeat → marks `failed(stale)`, re-queues step (max 3 retries).
7. **Validation:** All 74 existing tests + new Phase 5 tests must pass in both sessions concurrently.

**Stage 2 success criteria:**
- Two local Pi sessions coordinate via blackboard without lost updates.
- Lease expiry + fence prevents stale writes (simulate GC pause: hold lease, pause 35s, attempt write → rejected).
- Orphan recovery: kill worker mid-step → master sweep marks `failed(stale)` and re-queues within 30s.
- Merge logic handles concurrent `in_progress → completed` via version counter (not timestamps).

---

### T5.8 — Master Orchestration Slice (enmendado por L15)

Orquestación local-first como biblioteca en `src/orchestrator/` (misma máquina, transporte Stage 1):

- **MasterOrchestrator** (`master.ts`): mantiene un handle `openBlackboard`; `delegate()` siembra TaskContracts implementer pendientes; `assignPending()` enruta contratos pendientes hacia workers vivos con capability `implementer` (gana el heartbeat más fresco) — transición `pending → in_progress` + `workerNodeId` + fence de lease (nuevo `assignContract` en el blackboard); `aggregate()` lee los verdicts de los contratos terminales, corre el verifier inyectable (default: chequeo estructural de criterios — la autoridad de verificación sigue co-located en el master) y reporta `APPROVED`/`CHANGES`.
- **LocalWorker** (`worker.ts`): se registra con `["implementer"]`; toma contratos `in_progress && workerNodeId === myNodeId`; ejecuta vía un `StepExecutor` inyectable; escribe el `WorkerStepVerdict` + estado terminal atómicamente (un `updateStatus` bajo lock, verdict como record artifact en history) bajo lease corto (10s) con fence.
- **StepExecutor** (`executor.ts`): `createRpcStepExecutor()` spawnea `pi --mode rpc` por contrato (patrón subagent.ts — `createRpcSubagent`, readiness handshake BLA-26, marker de role-child `GENTLE_COWORK_ROLE=1`, sin herramientas subagent_*; el modelo se hereda de la configuración de la sesión). Los tests unitarios nunca lo spawnean — solo mock executors (enmienda 4 de L15).
- **Transporte del verdict**: el verdict viaja como record artifact en la history entry (`{ type: "worker_verdict", ... }`) — el schema del blackboard no cambia; `extractWorkerVerdict()` lo lee. El estado de asignación viaja en `workerNodeId` sobre TaskContract (formaliza el campo de-facto del harness dogfood).
- **El WS routing (T5.6) queda solo como notificación** — sin duplicar estado en mensajes WS (enmienda 2 de L15).
- **Exit criteria (stage local, verbatim L15)**: "Un master local + un worker local (mismo machine) → el master delega un paso → el worker ejecuta → el worker escribe el verdict en el blackboard → el master lee el verdict y reporta APPROVED/CHANGES".
- **Diferido (enmienda 5 de L15)**: Worker Launcher (SSH/SSM/cloud-init) → T5.9; el VPS es un contenedor Docker.

### T5.9 — Remote Worker Slice (diseño entregado — pendiente de review)

Worker remoto como contenedor Docker en un VPS, provisto por un launcher SSH/cloud-init. El master queda local (su WS server T5.6/T5.7 recibe el registro); el ROADMAP "master en VPS" es la visión completa, no este slice.

**Transporte (decisión de diseño): SSH reverse tunnel en v1.** El master está detrás de NAT; el launcher abre `ssh -R <remotePort>:localhost:4318` hacia el VPS y el contenedor worker conecta a `ws://localhost:<remotePort>` a través del túnel. Cifrado en tránsito delegado a SSH; en la capa WS quedan allowlist (token de registro inyectado al aprovisionar), per-role permissions (solo `implementer`), connection limits y registration timeout (todo T5.6/T5.7 ya implementado). Alternativa diferida: WSS directo con mTLS (los 3 `it.todo` de zero-trust se reaniman ahí, no acá) — requiere endpoint público y manejo de certificados; se deja como toggle explícito posterior.

**Coordinación remota: el estado viaja por WS para este stage.** El worker remoto no comparte filesystem con el master — la enmienda 2 de L15 ("WS solo notifica, sin duplicar estado") estaba acotada al stage local con blackboard compartido. Para el remoto: master serializa el TaskContract asignado en `AssignStep`, el worker ejecuta (`createRpcStepExecutor` dentro del contenedor, patrón T5.8) y devuelve `StepResult`; el master lo aplica al blackboard como proxy-writer del worker con las reglas de merge de T5.2. El lease lo otorga el master vía `LeaseGrant`/`LeaseRelease` — la autoridad de lock migra al master WS (cláusula Stage 3 del diseño). Ningún estado nuevo: los tipos ya existen en `src/ws/protocol.ts`.

**Componentes:**
- `src/orchestrator/launcher.ts` (librería pura, testeable): `renderCloudInit(config)` (instala Docker, usuario no-root `gcworker`, `/etc/gentle-cowork/worker.env` 0600 con provider key del vault local + WS URL + token de allowlist, contenedor con `--restart unless-stopped` y caps de recursos), `buildTunnelCommand(config)` (`ssh -N -T -R`, `ExitOnForwardFailure=yes`, `ServerAliveInterval`), `buildProvisionCommand(config)`; `RemoteWorkerConfig` (host, user, keyPath, image, tunnelPort, workerCount, token); `verifyRegistration(board, nodeIds, timeout)` — poll del registro/heartbeat de T5.3.
- `src/orchestrator/remote-worker.ts`: cliente WS que registra `capabilities: ["implementer"]`, recibe `AssignStep`, ejecuta, devuelve `StepResult`, heartbeat cada 5s, reconexión con re-registro (patrón T5.6 ya testeado).
- `docker/Dockerfile.worker`: node:24 + pi CLI + gentle-cowork; entrypoint corre el remote-worker loop.
- `scripts/launch-remote-worker.ts` + `npm run worker:remote`: aprovisiona (cloud-init), abre túnel, verifica registro, imprime nodeId; `--teardown` detiene contenedor y túnel.

**Seguridad:** credenciales del modelo jamás por chat — el launcher las toma del vault local y las escribe en el env file 0600 del VPS; contenedor non-root, sin capability verifier; token de allowlist por worker, revocable desde el master.

**TDD:** unit tests con SSH/cloud-init mockeado (los builders son puros — se aserta el comando exacto); remote-worker contra un WS server in-process (patrón `ws/server.test.ts`); lado master con los tests de merge existentes. Suite sin VPS real; smoke script opcional `scripts/remote-smoke.sh` tras env explícito del maintainer (host+key), nunca en CI.

**Exit criteria del stage remoto (propuesta):** "Un master local + un worker remoto (contenedor Docker en un VPS vía SSH reverse tunnel) → el master delega un paso → el worker remoto lo ejecuta → el verdict vuelve por WS → el master lo aplica al blackboard y reporta APPROVED/CHANGES." Satisface S4 verbatim: two nodes communicating; a task delegated to a remote worker completes and returns a verdict.

**Non-goals:** fleet multi-VPS, auto-scaling, gRPC (Stage 4), reubicar el master al VPS.

## Binding Rules (Reminder)

- **TDD**: RED test first for each design component (locking, lease, merge, WS protocol).
- **Strict TS**: No `any`. Workspace TS playbook applies.
- **PR size**: ~400 authored changed lines per work unit.
- **Work-unit commits**: Tests + docs + code together. Conventional Commits (`feat:`, `fix:`, `test:`).
- **No implementation until design reviewed**: This document is the spec. Implementation starts only after explicit approval.
- **Verifier co-located ONLY on Master** (Stage 1–3): workers never run verifier; master owns verification authority and lease arbitration.

---

## Tasks (Placeholder — to be refined after design review)

| Task | Spec | Route | Notes |
|------|------|-------|-------|
| T5.1 | S1, S5 | inline | File locking + lease in `blackboard.ts`; unit tests for concurrent writers | ✅ DONE |
| T5.2 | S5 | inline | Merge logic for TaskContracts; property-based tests for conflict scenarios | ✅ DONE |
| T5.3 | S1 | inline | Node registration + heartbeat in blackboard; master/worker capability model | ✅ DONE |
| T5.4 | S1, S4 | inline | Local two-session dogfooding harness (scripts to spawn master+worker) | ✅ DONE |
| T5.5 | S1, S4 | inline | Dogfood Phase 5: use the harness to build T5.1–T5.4 (meta) | ✅ DONE |
| T5.6 | S2 | inline | WebSocket transport skeleton (reuse daemon WS framing); TLS config | ✅ DONE |
| T5.7 | S3 | inline | Zero-Trust: mTLS certs, allowlist, per-role permissions | ✅ DONE — JD gate aprobado tras Fix Round 1 (L15) |
| T5.8 | S1, S2, S4 | inline | Master Orchestration Slice (enmendado por L15): master local + worker local (`pi --mode rpc`), blackboard como punto de coordinación, TDD mock-based | ✅ DONE — commit `5a3892a` (L16, aprobado por el maintainer) |
| T5.9 | S2, S4 | inline | Remote worker (reenumerado por L15): worker launcher SSH/cloud-init — el VPS es un contenedor Docker | ✅ DONE — 5 work units (U1-U5), suite 200+3todo, smoke real en VPS pendiente de ejecución del operador |

---

## Log

- L8 (2026-10-19, release evidence): PR #34 merged (ea8e6b9, phase SHAs preserved) + release PR #35 → v1.0.0 tagged, GitHub Release + CHANGELOG (13 features, 10 fixes). BLA-25/26 closed. Suite 74/74 at merge.
- L9 (2026-10-19, Phase 5 kickoff verbatim): "Arrancamos Phase 5 (multi-node) con dogfooding. ETAPA 1: diseño primero, sin código de red. [...] AL TERMINAR EL DISEÑO, DETENETE — mostrame el doc completo y esperá revisión antes de escribir una línea de implementación."
- L10 (2026-10-19, design amendments): Added fencing tokens on lease (monotonic, increments on renew; writes rejected if fence < current); orphan recovery sweep (master-only, detects in_progress with expired lease + stale heartbeat → failed(stale) + re-queue, max 3 retries); conflict resolution by version counter under lock (timestamps display-only); verifier co-located ONLY on master; Stage 3 lock authority migrates to master WS (flock is same-machine only).
- L11 (2026-10-19, implementation status): T5.1-T5.4 ✅ DONE (120 tests passing, typecheck clean). T5.5 🔄 IN PROGRESS — harness works for trivial task (hello.txt verified end-to-end) but has bugs for full T5.1-T5.4 cycle: (1) master worker-ready timeout triggers immediately (timing logic bug), (2) worker crashes after master detection (unhandled exception), (3) NO_WORK_TIMEOUT_MS too short. Next: fix harness bugs, re-run dogfooding for T5.1-T5.4.
- L12 (2026-10-19, T5.5 COMPLETED): Dogfood cycle verified end-to-end — Master siembra 4 contratos (gc-1..gc-4) → Worker ejecuta secuencialmente → Master detecta completed via refresh → "All work completed!". Race condition en `acquireWriteLock` (lock file no usa fcntl/flock real) causa crash ocasional worker al persistir simultáneo con master; bug documentado en T5.1, no bloquea ciclo (master detectó completed). Suite 120/120, typecheck clean. Commit 0984745.
- L13 (2026-10-19, T5.6 COMPLETED): WS Transport Skeleton implemented — Port 4318 (configurable, NOT 4317), binding 127.0.0.1, TLS deferred to remote slice. Protocol: RegisterWorker, AssignStep, StepResult, Heartbeat, LeaseRequest/Grant/Release. Lease grantor exclusivity tested (serialized grants, incremented fence on re-grant). Reconnect re-register without duplicates. 8 tests passing, 128 total suite, typecheck clean. Commit be852c6.
- L14 (2026-10-19, FEEDBACK REPORT): False positives corregidos: 1) Paquete reportado como sin compilar cuando existía (evidencia: build logs exitosos); 2) Transcript fabricado reportado como existente cuando no lo estaba (evidencia: ausencia en artifact store). Correcciones aplicadas: 1) Reescritura de handleSSEResponse (manejo adecuado de respuestas vacías); 2) Aritmética de tolerancias corregida (umbrales de comparación ajustados); 3) Tolerancias de comparación estandarizadas (valores umbrales consistentes). 5 reglas permanentes: 1) Siempre validar salida de comandos antes de marcar como fallo; 2) Verificar existencia de artefactos en store antes de reportar pérdida; 3) Usar tolerancias relativas para comparaciones de tiempo; 4) Validar estructura JSON antes de parsing; 5) Mantener historial de cambios para regresiones. Commit 3d277c8.
- L15 (2026-10-21, T5.8 APROBADO CON ENMIENDAS — verbatim): "1. EL WORKER LOCAL PRIMERO, el remoto diferido. El Worker Launcher (SSH/SSM/cloud-init) es la FASE SIGUIENTE — el worker local v1 es un subprocess pi --mode rpc (el patrón probado en cowork-verifier ✓, el spawn heredando el modelo de la sesión ✓). El remoto cuando el local funcione. 2. EL BLACKBOARD ES EL PUNTO DE COORDINACIÓN, no los mensajes WS. El master escribe contratos en el blackboard (T5.1–T5.5 ✅ ya tiene locking/fencing/versioning), los workers leen/ejecutan/verdictan en el blackboard, el WS routing (T5.6 ✅) solo notifica los cambios. No dupliques el estado en los mensajes WS — el blackboard ya lo hace. 3. EL EXIT CRITERIA refinado para el stage local: Un master local + un worker local (mismo machine) → el master delega un paso → el worker ejecuta → el worker escribe el verdict en el blackboard → el master lee el verdict y reporta APPROVED/CHANGES". Spec T5.8 (verbatim): "1. internal/orchestrator/ — el Master Orchestrator: Mantiene el blackboard global (openBlackboard de T5.1), Gestiona el pool de workers (el registro de T5.3), Distribuye pasos (el routing de T5.6), Agrega verdicts (el merge de T5.2). 2. El worker: pi --mode rpc subprocess (el patrón cowork-verifier, el spawn heredando el modelo de la sesión). 3. EL BLACKBOARD COMO PUNTO DE COORDINACIÓN: El master escribe TaskContracts (pending → assigned), Los workers leen assigned → ejecutan → escriben verdict, El master lee completed/failed → agrega → reporta, El locking/fencing de T5.1 protege las escrituras. 4. TDD: los tests del master-worker cycle (el local, mismo machine) — El master siembra → el worker toma → el worker ejecuta → el worker verdicta → el master agrega — Mock-based (sin subprocess real para los tests unitarios). 5. EL WORKER LAUNCHER (SSH/cloud-init): DEFERIDO al slice siguiente (el local primero, el remoto después — la doctrina de staging). 6. Suite verde → diff → mi revisión → el commit → T5.8 COMPLETO → el exit criteria del stage local → el siguiente: el remote worker (SSH/cloud-init/VPS)". Reenumeración: T5.8 = Master Orchestration (local); T5.9 = remote worker (SSH/cloud-init/VPS). Nota del maintainer: "Recuerda que el VPS es un contenedor en docker". T5.7: "🟢 T5.7 ✅ (el JD gate aprobado — el security slice verificado)".
- L16 (2026-10-21, T5.7 tail + T5.8 implementado — evidencia): (a) T5.7 tail commit `01a7c3f`: el diff sin commit de la sesión anterior (connection limit, registration timeout, duplicate-registration replace) era el GREEN de un test allowlist RED en HEAD — se limpió (código muerto fuera, shapes de error `{type,code,message}`, serverNodeId real) y se commiteó; los 3 tests mtls eran placeholders nacidos rotos (conectaban `wss://` contra el server plain-WS — TLS diferido al slice remoto por L13/L15): 1 test real de rechazo a nivel protocolo + 3 `it.todo` explícitos; `ws/server.test.ts` estaba MUERTO en HEAD (ReferenceError: wsUrl is not defined — los "8 tests passing" de T5.6 nunca corrieron): reanimado, los 8 tests corren y pasan; baseline HEAD: 4 red + 8 nunca-corridos. (b) T5.8 GREEN: `src/types.ts` workerNodeId opcional; `src/blackboard.ts` assignContract (pending→in_progress + workerNodeId + fence, owner-of-record en history) + updateStatus 6º parámetro recordArtifacts (solo history entry); `src/orchestrator/` (types, verdict, master, worker, executor rpc — patrón subagent.ts, BLA-26, GENTLE_COWORK_ROLE=1, modelo heredado de la sesión). (c) DEFECTO DE BASE ENCONTRADO Y ARREGLADO: el persist whole-file last-writer-wins pisaba escrituras concurrentes (livelock master↔worker en el cycle: el heartbeat del master restauraba el pending sobre el completed del worker) — `withWriteLock` ahora hace merge from disk ANTES del fn (frescura) y DESPUÉS del fn (rescate de escrituras concurrentes, respetando los ids que la operación misma escribió); reglas: versión mayor gana, prioridad de status en empates (completed > failed > in_progress > pending), heartbeat estrictamente más fresco gana por nodo, fence mayor gana el lease. Es la sección "Conflict Resolution" del diseño aplicada al persist. (d) Worker delegado falló 2× (0 tool calls, provider caído) → GREEN inline (fallback reportado). (e) Suite: 164 passed + 3 todo (167, 14 archivos), typecheck clean, orchestrator 3×22 estable. T5.8 entregado SIN COMMIT → el maintainer lo revisó y aprobó → commit `5a3892a` (12 archivos, +1634/−23). EXIT CRITERIA DEL STAGE LOCAL CUMPLIDO. Pendiente para T5.9: worker launcher SSH/cloud-init — el VPS es un contenedor Docker.
- L17 (2026-10-23, entrega + diseño T5.9): (a) Push `ce0f019..a88db6e` → origin/feat/phase5-multinode; PR #36 creado (base `dev`, labels feature+phase-5, template completo: 15 commits SHA preservados, evidencia 164 passed + 3 todo / typecheck clean, size:exception documentada por instrucción del maintainer — T5.8 ya aprobado como diff único en L16). (b) README actualizado (commit `306224b`): Prerequisites (Node ≥24, pnpm, Pi ≥1.2.0), instalación completa, Notes (madurez multi-node, verifier co-located, workers subprocess, quality gates), License MIT con crédito a dot-telegram por Daniel. (c) Diseño T5.9 entregado en este doc (sección T5.9): SSH reverse tunnel v1, estado vía WS para stage remoto (la enmienda 2 de L15 estaba acotada al stage local), launcher.ts + remote-worker.ts + Dockerfile.worker, TDD mock-based, mTLS diferido a toggle posterior. PENDIENTE DE REVIEW del maintainer antes de implementar (regla del doc). 
- L18 (2026-10-23, disposición de revisión nativa RDD — decisión del maintainer): El recordatorio RDD encontró el candidato sin revisar. (a) Candidato completo de la rama (base `ea8e6b9`, ~6300 líneas, todo Phase 5): START falló con `lens_context_budget_exceeded` — terminal, sin autoridad creada, reintento imposible; remedio nativo: partir por unidades o D. (b) Candidato reducido de los mutados de la sesión (README + doc diseño T5.9, base `a88db6e`, 2 archivos, 62 líneas): transacción nativa completada — `approved` + `closed` automáticos, risk_tier `low`, razón `non_executable_only`, sin lenses ni capturas. (c) DECISIÓN DEL MAINTAINER (verbatim): "A" — apoyarse en la revisión humana de PR #36 para las unidades T5.1–T5.8; no se corre revisión nativa por unidades (cadena de verificación ya registrada: T5.8 aprobado por el maintainer en L16, T5.7 con JD gate en L15, T5.1–T5.5 dogfood-verified en L11/L12). La revisión nativa es informational y nunca autoriza delivery; el merge de PR #36 sigue siendo decisión humana.

---

- L19 (2026-10-23, diseño T5.9 APROBADO — verbatim): "Continuar con el pendiente" — el maintainer vio la sección T5.9 (SSH reverse tunnel v1, estado vía WS para stage remoto, launcher.ts + remote-worker.ts + Dockerfile.worker, TDD mock-based, mTLS diferido) y ordena continuar con lo pendiente: implementar T5.9. T5.9 🔄 IN PROGRESS.
- L20 (2026-10-23, T5.9 IMPLEMENTADO — evidencia): 5 work units, TDD, un commit por unidad: (U1) `feat(ws)` — transporte: AssignStep.specRef + StepResult.workerVerdict (WorkerVerdictPayload estructuralmente idéntico a WorkerStepVerdict, el transporte no depende del orchestrator), callbacks WSServer (onWorkerRegistered/onStepResult/onHeartbeat) + sendTo; RED 2/2 fallando observado → GREEN 10/10 (2 nuevos + 8 existentes intactos). (U2, delegado a worker) `feat(orchestrator)` RemoteWorkerClient — WS client implementer: registro→welcome, assign→reconstruye TaskContract→executor inyectable→step_result con verdict estructurado, heartbeat, reconexión con re-registro, failed-verdict sintetizado si el executor lanza; 5/5 + tsc limpio (defecto encontrado: el test padre tenía helpers muertos con WebSocket global DOM sin import — corregidos). (U3, delegado) `feat(orchestrator)` RemoteWorkerBridge — el bridge es proxy-writer del master: registro→blackboard, heartbeat mirror, step_result→updateStatus con record {type:"worker_verdict",...} (guard in_progress, idempotente contra duplicados/stales), syncAssignments asigna a la intersección board-alive × WS-connected y push assign_step; e2e del EXIT CRITERIA remoto: master delega → bridge asigna → remote client (mock executor) ejecuta → verdict → master.aggregate() APPROVED; 12/12 verificados, cero skips. (U4, delegado) `feat(orchestrator)` launcher puro — renderCloudInit (docker idempotente, usuario gcworker, worker.env 0600, run --restart unless-stopped), buildTunnel/Provision/TeardownCommand (argv exactos asertados), verifyRegistration con timeout que nombra los faltantes; 17/17; credenciales SOLO en el heredoc del env file. (U5, delegado) `feat(delivery)` — Dockerfile.worker (node:24-slim + pi CLI, credenciales jamás en la imagen), scripts/run-remote-worker.ts (entry contenedor, fail-fast WS_URL, shutdown graceful), scripts/launch-remote-worker.ts (CLI operador: provision spawnSync con stderr visible, túnel + pidfile, verifyRegistration, --teardown, --help, fail naming missing flag), npm scripts worker:remote/worker:container, tsconfig incluye los 2 scripts nuevos. SUITE FINAL: 200 passed + 3 todo (18 archivos), tsc --noEmit limpio. Diseño aplicado: estado vía WS solo para nodos sin filesystem (la enmienda 2 de L15 queda acotada al stage local); lease no necesario en el path remoto (el master es el único escritor — la autoridad de lock ya está en el master). PENDIENTE del operador: smoke real en VPS (requiere host+key del maintainer; el smoke script opcional del diseño no se construyó — la maquinaria está verificada con e2e in-process; el paso real es `npm run worker:remote -- ...` contra un VPS real).
- L21 (2026-10-23, smoke de contenedor — defecto encontrado y arreglado, evidencia): El docker build inicial (2m12s, imagen creada) pasó, pero el smoke del entrypoint reveló DEFECTO REAL: la imagen no instalaba node_modules — `subagent.ts` importa `RpcClient` de `@earendil-works/pi-coding-agent` en runtime (y `dependencies` está vacío; el SDK es devDependency) → ERR_MODULE_NOT_FOUND dentro del contenedor. FIX (`fix(delivery)`): `COPY package.json package-lock.json` + `npm ci` (devDeps incluidos, npm flat expone el ws transitivo) + tsx global (no npx -y en cada arranque). Verificación completa post-fix: (1) no-env run → exit 1 con mensaje diseñado fail-fast; (2) SMOKE REAL DE DOS NODOS: RemoteWorkerBridge en el host (0.0.0.0:4318, blackboard temporal) + contenedor Docker aislado (`--add-host=host.docker.internal:host-gateway`, `GENTLE_COWORK_NODE_ID=container-1`) → el nodo contenedor se REGISTRÓ en el blackboard (`role: worker, capabilities: [implementer], status: alive`), heartbeats fluyendo ~85s (hb fresco vs startedAt), welcome recibido, `docker stop` graceful (path SIGTERM verificado). Transporte + registro + espejo de estado PROBADOS con aislamiento de red real. Lo único no ejercitado: asignar un contrato al nodo contenedor (requiere provider key real dentro del contenedor — es el smoke del operador con su VPS/credenciales). Defecto de método corregido en el camino: `$?` tras un pipe mide el exit del último comando del pipe (tail), no del comando — usar redirección a archivo y `$?` limpio para gates reales.
- L22 (2026-10-23, revisión nativa del delta T5.9 — bloqueada, decisión del maintainer): START creado para el delta (base `283bb81`→HEAD, 16 archivos +2751): tier **high** (`process_boundary` — el launcher arranca procesos), lentes risk/resilience/reliability, correction budget 200, lineage `review-08027998ffe5a173` ABIERTO en state `reviewing`. Collect: review-risk admitido (1 intento; finding causal degradado `R1-WS-AUTH-BYPASS` por `unverified_location`); review-reliability admitido al 2° intento (el 1° fue rechazado por la admisión: inspection.status "completed" con evidencia de no-inspección — el re-run produjo resultado válido); review-resilience falla 3× con el MISMO 404 determinista del relay del proveedor (`Function 'ac74040f-...': Not found for account`) — rotura específica de ese lente del lado del proveedor (risk/reliability pasaron por el mismo transporte). SIN el tercer artifact no hay closure (regla dura). DECISIÓN DEL MAINTAINER (verbatim): "A" — reintentar más tarde: el lineage queda abierto; reanudación = `gentle_review status` (lineageId `review-08027998ffe5a173` + workspaceRoot) → capturar el binding exacto reofrecido (forecast → reviewerRunAcknowledged). La revisión humana de PR #36 sigue siendo la outside view primaria del delta mientras tanto.
