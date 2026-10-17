# 🏗️ gentle-cowork — Orchestration Extension for Pi/gentle-shell

> A Pi extension that turns ODD-approved delegation into a structured, verified, multi-role workflow. Delegate by named reason, never by size.

---

## 🎯 The Problem It Solves

When working with AI coding agents on complex projects, delegation often becomes a black box:

- The agent makes ALL changes itself — no independent verification
- No specialization — one agent does planning, coding, and review
- No transparency — you don't know which files were touched or why
- No fallback — if the agent fails, you start over

**gentle-cowork** solves this by adding a layer of specialized subagent roles that ODD (Organic Driven Development) activates when the work genuinely needs delegation.

---

## 🧠 The Three Specialized Roles

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   🧠 PLANNER ──────→ 🔨 IMPLEMENTER ──────→ ✅ VERIFIER │
│   (read-only)        (scoped write)       (read+tests)  │
│                                                         │
│   Decomposes         Executes ONE         Validates      │
│   the objective      step within          changes per    │
│   into a plan        its scope            ODD spec S#    │
│                                                         │
│   Returns:           Returns:             Returns:       │
│   • Plan (JSON)      • Artifact summary   • Verdict      │
│   • Scope            • Files modified     • Evidence     │
│   • Criteria         • Logic added        • Per S#       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### cowork-planner
- **Access:** `read`, `grep`, `find`, `ls` — read-only
- **Job:** Reads the ODD spec by reference, decomposes the objective into independently verifiable steps
- **Output:** A JSON plan with steps, file scope, and acceptance criteria

### cowork-implementer
- **Access:** `read`, `write`, `edit` — scoped write only
- **Job:** Executes ONE step from the plan, only touching files within its allowed scope
- **Output:** An artifact summary (files modified, changes made, notes)

### cowork-verifier
- **Access:** `read`, `bash` (test execution only) — read + tests
- **Job:** Validates changes against the ODD spec, requirement by requirement (S#)
- **Output:** A structured verdict — `APPROVE` (all pass) or `CHANGES` (any fail, with details)

---

## 🔄 The Workflow

```
User: "I need X"
       │
       ▼
┌─ ODD classifies ──────────────────────────────┐
│  Is this small and understood? → Handle inline│
│  Does it need delegation? → Named reason?     │
│    (parallelism, independent verify, backstop)│
└───────────────────────────────────────────────┘
       │ Yes — named reason exists
       ▼
┌─ gentle-cowork activates ─────────────────────┐
│                                               │
│  1. Planner reads spec → returns plan         │
│  2. Implementer executes step → artifact      │
│  3. Verifier validates → verdict              │
│     ├── APPROVE → next step                   │
│     └── CHANGES → retry (max 3)               │
│                                               │
└───────────────────────────────────────────────┘
       │
       ▼
  Commit with evidence
```

---

## 📋 The TaskContract

Every delegation carries a lightweight contract — **not** an SDD artifact:

```typescript
interface TaskContract {
  id: string;                    // unique identifier
  objective: string;             // what needs to be done
  role: CoworkRole;              // planner | implementer | verifier
  scope: string[];               // allowed files/directories
  acceptanceCriteria: string[];  // definition of "done"
  specRef: string;               // path to ODD spec (BY REFERENCE)
  artifacts: string[];           // results produced
  status: TaskStatus;            // pending | in_progress | completed | failed
}
```

**Key design decision:** The `specRef` field points to the ODD feature document (`odd/tasks/<feature>.md`). Subagents read the spec **by reference** — never a paraphrased summary. This preserves requirement fidelity (per gentle-shell PR #1718).

---

## 🛡️ When Does the Orchestrator Delegate?

The orchestrator (Pi/gentle-shell) delegates to gentle-cowork **only when a named reason exists**:

| Named Reason | Example |
|---|---|
| **Real parallelism** | Two independent modules can be built simultaneously |
| **Independent verification** | The implementer's work needs a separate reviewer |
| **Context backstop** | The main agent's context is getting large; delegate to a fresh subagent |
| **Specialized expertise** | The task requires a specific tool set (e.g., test execution only) |

### When it does NOT delegate:

- Small, understood work → handled inline by ODD
- Single-file changes → handled inline
- No clear reason → even if the task "looks big"
- Uncertain objectives → ask the user first

---

## 🚫 What gentle-cowork is NOT

- **NOT a silent SDD** — no formal proposal/spec/design artifacts
- **NOT a sprint system** — activation by complexity threshold, not calendar
- **NOT a fork** — it's an extension using Pi's existing extension mechanism
- **NOT a replacement for gentle-ai review** — the verifier INVOKES gentle-ai's review authority, never replaces it

---

## 📊 Current Status

| Phase | Status | What's Done |
|---|---|---|
| Phase 0 — Skeleton | ✅ Complete | Project structure, types, extension entry, agents, skill |
| Phase 1 — Single-role verify | ✅ Complete | Verifier subagent spawns and returns verdicts |
| Phase 2 — Full chain | 🔄 In Progress | Planner → Implementer → Verifier cycle with tests |
| Phase 3 — ODD invisible | 📋 Todo | tool_call hook for natural delegation |
| Phase 4 — Blackboard state | 📋 Todo | Shared orchestration persistence |
| Phase 5 — Multi-node | 🔮 Future | Master/Worker VPS architecture |

---

## 🤝 How to Contribute

The project is open source (MIT). Areas where help is welcome:

- Testing the verifier logic with real-world projects
- Designing additional roles (e.g., `cowork-documenter`)
- Building the Blackboard state system
- Multi-node communication protocols

---

*Built with ❤️ as part of the Gentle ecosystem — ODD by default, delegation by design.*
