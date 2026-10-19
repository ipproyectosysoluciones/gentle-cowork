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
| T5.5 | S1, S4 | inline | Dogfood Phase 5: use the harness to build T5.1–T5.4 (meta) | 🔄 IN PROGRESS (harness bugs: master timeout bug + worker crashes) |
| T5.6 | S2 | inline | WebSocket transport skeleton (reuse daemon WS framing); TLS config | ⏳ PENDING |
| T5.7 | S3 | inline | Zero-Trust: mTLS certs, allowlist, per-role permissions | ⏳ PENDING |
| T5.8 | S2, S4 | inline | Network two-node test (local → VPS simulation via Docker/network namespace) | ⏳ PENDING |
| T5.9 | S4 | inline | Horizontal scaling: dynamic worker registration, load-aware step routing | ⏳ PENDING |

---

## Log

- L8 (2026-10-19, release evidence): PR #34 merged (ea8e6b9, phase SHAs preserved) + release PR #35 → v1.0.0 tagged, GitHub Release + CHANGELOG (13 features, 10 fixes). BLA-25/26 closed. Suite 74/74 at merge.
- L9 (2026-10-19, Phase 5 kickoff verbatim): "Arrancamos Phase 5 (multi-node) con dogfooding. ETAPA 1: diseño primero, sin código de red. [...] AL TERMINAR EL DISEÑO, DETENETE — mostrame el doc completo y esperá revisión antes de escribir una línea de implementación."
- L10 (2026-10-19, design amendments): Added fencing tokens on lease (monotonic, increments on renew; writes rejected if fence < current); orphan recovery sweep (master-only, detects in_progress with expired lease + stale heartbeat → failed(stale) + re-queue, max 3 retries); conflict resolution by version counter under lock (timestamps display-only); verifier co-located ONLY on master; Stage 3 lock authority migrates to master WS (flock is same-machine only).
- L11 (2026-10-19, implementation status): T5.1-T5.4 ✅ DONE (120 tests passing, typecheck clean). T5.5 🔄 IN PROGRESS — harness works for trivial task (hello.txt verified end-to-end) but has bugs for full T5.1-T5.4 cycle: (1) master worker-ready timeout triggers immediately (timing logic bug), (2) worker crashes after master detection (unhandled exception), (3) NO_WORK_TIMEOUT_MS too short. Next: fix harness bugs, re-run dogfooding for T5.1-T5.4.

---