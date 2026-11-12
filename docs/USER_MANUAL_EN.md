# User Manual — gentle-cowork

**Version:** 1.2.2 | **Date:** 2026-11-12 | **Compatibility:** Pi / gentle-shell ≥ 1.5.0

---

## 📋 Table of Contents

1. [Introduction](#introduction)
2. [Quick Installation](#quick-installation)
3. [Available Commands](#available-commands)
4. [ODD Workflow](#odd-workflow)
5. [The Three Roles](#the-three-roles)
6. [Multi-Node (Dogfooding)](#multi-node-dogfooding)
7. [Zero-Trust Security](#zero-trust-security)
8. [Native Verification](#native-verification)
9. [Troubleshooting](#troubleshooting)

---

## Introduction

**gentle-cowork** is a multi-role orchestration extension for **Pi / gentle-shell** that turns **Organic Driven Development (ODD)** delegation decisions into a structured, verified, multi-role workflow — without ever becoming a silent SDD framework.

### What makes gentle-cowork different?

| Principle | Description |
|---|---|
| **Never by size** | Delegation triggers only on named reasons: real parallelism, independent verification, context backstop |
| **Spec by reference** | Subagents receive the path to the ODD document, never a paraphrased summary |
| **Lightweight contracts** | Each delegation carries a `TaskContract` — no formal proposal/spec/design documents |
| **Flat tree** | Subagents never spawn sub-subagents |
| **Invisible to ODD** | User describes what they need; extension routes naturally |

### Prerequisites

- **Node.js ≥ 24** (pure ESM)
- **pnpm** (or npm) as package manager
- **Pi / gentle-shell ≥ 1.5.0** — this is an extension, not a standalone tool
- **Git**

---

## Quick Installation

```bash
# 1. Clone and install dependencies
git clone https://github.com/ipproyectosysoluciones/gentle-cowork.git
cd gentle-cowork
pnpm install

# 2. Configure API keys / models
cp .env.example .env
# Edit .env with your keys:
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# NVIDIA_API_KEY=nvapi-...
# OLLAMA_BASE_URL=http://localhost:11434

# 3. Mandatory verification — both gates must be GREEN
npx tsc --noEmit      # Strict TypeScript, zero errors
npx vitest run        # 321 tests pass

# 4. Load into your Pi session
pi -e ./src/gentle-cowork.ts
```

**Permanent installation** (optional):
```bash
cp src/gentle-cowork.ts ~/.pi/agent/extensions/gentle-cowork.ts
```

---

## Available Commands

The extension registers **5 commands** in the Pi session:

| Command | Description | Phase |
|---|---|---|
| `/cowork` | Show orchestration status (last contract, role, status) | 0 |
| `/cowork-contract` | Show the last TaskContract as JSON | 0 |
| `/cowork-verify` | Spawn cowork-verifier subagent (Phase 1 test) | 1 |
| `/cowork-chain` | Run full planner → implementer → verifier chain | 2 |
| `/cowork-dogfood` | Run dogfooding natively via Pi background jobs | 5 |

### Dogfood Subcommands

```bash
/cowork-dogfood run [--timeout 300]      # Master + worker via bash_background (default 300s)
/cowork-dogfood master --shared-dir PATH # Master only
/cowork-dogfood worker --shared-dir PATH # Worker only
/cowork-dogfood help                     # Show usage
```

---

## ODD Workflow

### Spec by Reference
Every delegation carries a `specRef` pointing to an ODD task document under `odd/tasks/<feature>.md`:

```
odd/tasks/<feature>.md
├── ## Specs (S1, S2, S3...) — numbered requirements quoting user's exact words
├── ## Tasks (T1, T2, T3...) — one line per task: ID, linked S#, route, commit
└── ## Log (L1, L2, L3...) — original request verbatim + corrections, evidence, decisions
```

### Delegation Triggers (named reasons only)
The `tool_call` hook intercepts delegations **only when ODD has already classified a valid reason**:

1. **Real parallelism** — 2+ independent units of work (~100+ lines each, launched together)
2. **Independent verification** — High-risk item requiring `gentle-ai-verify` (data, security, contracts, concurrency, delivery, no-net)
3. **Context backstop** — Session hit ~150k tokens, delegate next unit

**Without a named reason** (`reason` field in tool input), **native delegation proceeds untouched**.

### Contract Persistence (Phase 4)
Every `TaskContract` transition is persisted to the shared blackboard (`.gentle-cowork/blackboard.json`):
- Atomic JSON with file locking (`.lock` + random suffix)
- Version counter for optimistic concurrency
- Lease/fence with cryptographic tokens (`generateFence`)
- Survives daemon restarts (`session_start` reloads)

---

## The Three Roles

| Role | Permission | Responsibility |
|---|---|---|
| 🧠 **cowork-planner** | read-only | Decompose objective into plan with scope + acceptance criteria |
| 🔨 **cowork-implementer** | scoped write | Execute one plan step; produce artifact summary |
| ✅ **cowork-verifier** | read + tests | Validate per ODD spec requirement (S#) via **native gentle-shell review** (`review.start`/`review.finalize`, lenses `review-readability` + `review-reliability`); emit `APPROVE` or `CHANGES` |

**The intelligence stays agent-side.** The bridge/extension only routes — every delegation sends a pre-crafted prompt to the assistant, which uses its native tools.

### Execution Chain (Phase 2)

```
Planner → Implementer → Verifier
   ↓           ↓           ↓
  plan      artifact    verdict per S#
                              ↓
                        APPROVE → next step
                        CHANGES → retry (max 3)
```

---

## Multi-Node (Dogfooding)

### Local (Phase 5 — Complete)

Two Pi sessions on the same machine coordinate through shared blackboard:

```bash
# Terminal 1: Master
npm run dogfood:master -- --shared-dir /tmp/cowork-shared

# Terminal 2: Worker (in another Pi session)
npm run dogfood:worker -- --shared-dir /tmp/cowork-shared

# Or both via native background jobs (single command)
npm run dogfood:run
```

### Remote (Phase 5 — In Progress)

Run a worker on a remote VPS (Docker container over SSH reverse tunnel):

```bash
npm run worker:remote -- --host <vps-host> --user <vps-user> \
  [--key <ssh-key-path>] --token <allowlist-token> \
  --env OPENAI_API_KEY=... --expected-node <worker-node-id>
```

The launcher provisions the VPS (installs Docker, writes `/etc/gentle-cowork/worker.env` mode 0600, starts worker container with `--restart unless-stopped`), opens SSH reverse tunnel to master's WS port, and verifies worker registration on the blackboard.

---

## Zero-Trust Security (T5.7)

The multi-node transport includes a zero-trust layer:

| Layer | Feature | Status |
|---|---|---|
| **C1** | mTLS with x509 certificates | ✅ |
| **C3** | Message size limits | ✅ |
| **C5** | JSON depth limit | ✅ |
| **C6** | wss:// TLS config | ✅ |
| **C7** | Rate limiting | ✅ |
| **C9** | Inbound message text length limits | ✅ |
| **L1** | Security headers on Admin API | ✅ |
| **L2** | Audit log for admin mutating actions | ✅ |
| **L3** | Application-level ping/pong | ✅ |
| **M1** | Rate limiting for admin mutating endpoints | ✅ |
| **M3** | Explicit inbound message text length limits | ✅ |

Admin API endpoints (mutating): `/api/admin/allowlist`, `/api/admin/pair/start`, `/api/admin/pair/regenerate`, `/api/admin/pair/cancel`, `/api/admin/verify`, `/api/admin/unpair`

---

## Native Verification

The `cowork-verifier` uses **gentle-shell native review integration**:

```
review.start → lenses: review-readability (S1) + review-reliability (S2)
     ↓
captureResult (evidence per S#)
     ↓
acknowledgeApproved → authority burned
```

- **Per-S# verdict:** `pass` / `fail` / `untested`
- **Outcome:** `APPROVE` or `CHANGES` (triggers retry loop, max 3)
- **Implementation:** `runNativeVerify()` in `src/verifier.ts`

---

## Troubleshooting

### Tests not passing
```bash
# Verify TypeScript
npx tsc --noEmit

# Run specific test files
npx vitest run src/zero-trust/role-permissions.test.ts
npx vitest run src/verifier.test.ts
```

### WebSocket connection refused
- Verify server is running on port 4322 (TEST_PORT)
- Verify CA certificate in `ca.pem`
- Verify `TEST_PORT` environment variable

### Subagent not responding
- Check `READINESS_ATTEMPTS=15` and `READINESS_DELAY_MS=2000` in `src/subagent.ts`
- Check `VERIFY_TIMEOUT_MS=300000` and `CHAIN_TIMEOUT_MS=900000`
- Verify `promptAndWait` receives timeout as 3rd argument

### Rate limiting on Admin API
- Limit: 60 req/min per IP (token bucket)
- Security headers always present: `x-content-type-options: nosniff`, `x-frame-options: DENY`, `content-security-policy: default-src 'none'; frame-ancestors 'none'`

---

## Useful Links

- **Repo:** https://github.com/ipproyectosysoluciones/gentle-cowork
- **Roadmap:** [ROADMAP.md](../ROADMAP.md)
- **Contributing:** [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md)
- **CHANGELOG:** [CHANGELOG.md](../CHANGELOG.md)
- **Gentle-AI:** https://github.com/Gentleman-Programming/gentle-ai