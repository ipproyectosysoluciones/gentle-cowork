#!/usr/bin/env node
/**
 * dogfood-master — Master orchestration for Phase 5 dogfooding.
 *
 * Runs the master orchestration loop that coordinates work via the blackboard.
 * The master acts as planner+verifier; workers handle implementer steps.
 * The master polls the blackboard for work completion — it does NOT wait on
 * worker processes. The blackboard is the source of truth.
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openBlackboard, defaultBlackboardPath, STATE_VERSION } from "../src/blackboard.ts";
import type { TaskContract, NodeRegistration } from "../src/types.ts";
import { makeContract, sleep } from "./dogfood-common.ts";

const MASTER_NODE_ID = `master-${process.pid}-${Date.now()}`;
const LEASE_TTL_MS = 30_000;
const ORPHAN_SWEEP_INTERVAL_MS = 10_000;
const LOOP_INTERVAL_MS = 1_000;

/** Phase 5 tasks to dogfood — the work this harness will build. */
const PHASE5_TASKS: Omit<TaskContract, "id" | "version" | "history" | "leaseFence" | "retryCount" | "status" | "artifacts">[] = [
  {
    objective: "Implement file locking (flock) in blackboard.ts",
    role: "implementer",
    scope: ["src/blackboard.ts"],
    acceptanceCriteria: [
      "acquireWriteLock uses lock file as portable mutex",
      "write operations are serialized across processes",
      "lock is released on error",
    ],
    specRef: "odd/tasks/gentle-cowork-phase5.md",
    workerNodeId: "",
  },
  {
    objective: "Implement lease mechanism with fencing tokens",
    role: "implementer",
    scope: ["src/blackboard.ts"],
    acceptanceCriteria: [
      "acquireLease returns fence=1 when no lease exists",
      "renewLease increments fence",
      "releaseLease clears lease",
      "putContract/updateStatus reject stale fence",
    ],
    specRef: "odd/tasks/gentle-cowork-phase5.md",
    workerNodeId: "",
  },
  {
    objective: "Implement orphan recovery sweep",
    role: "implementer",
    scope: ["src/blackboard.ts"],
    acceptanceCriteria: [
      "runOrphanRecovery marks failed(stale) when lease expired + heartbeat stale",
      "re-queues step with retryCount (max 3)",
      "does not recover contracts under current lease fence",
    ],
    specRef: "odd/tasks/gentle-cowork-phase5.md",
    workerNodeId: "",
  },
  {
    objective: "Implement merge logic with version counter",
    role: "implementer",
    scope: ["src/blackboard.ts"],
    acceptanceCriteria: [
      "mergeContracts merges new contract from another node",
      "higher version wins",
      "equal version: status priority completed > failed > in_progress > pending",
      "timestamps display-only",
    ],
    specRef: "odd/tasks/gentle-cowork-phase5.md",
    workerNodeId: "",
  },
];

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [MASTER] ${message}`);
}

function logContract(contract: TaskContract): void {
  log(`Contract ${contract.id} (${contract.role}): ${contract.objective} [${contract.status}] v${contract.version}`);
}


async function main(): Promise<void> {
  const tmpDir = join(tmpdir(), `gentle-cowork-dogfood-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  log(`Dogfood master starting in ${tmpDir}`);

  try {
    const filePath = defaultBlackboardPath(tmpDir);
    const board = openBlackboard(filePath);

    // Register as master
    const masterNode: NodeRegistration = {
      nodeId: MASTER_NODE_ID,
      role: "master",
      capabilities: ["planner", "verifier"],
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      status: "alive",
    };
    board.registerNode(masterNode);
    log(`Registered as master: ${MASTER_NODE_ID}`);

    // Wait for at least one worker to be registered and alive
    log(`Waiting for worker to be ready...`);
    const workerReadyStart = Date.now();
    const WORKER_READY_TIMEOUT_MS = 120_000; // 2 minutes
    while (true) {
      const workers = board.getNodes().filter((n) => n.role === "worker" && n.status === "alive");
      if (workers.length > 0) {
        log(`Worker detected: ${workers[0].nodeId}`);
        break;
      }
      if (Date.now() - workerReadyStart > WORKER_READY_TIMEOUT_MS) {
        log(`Worker not ready after ${WORKER_READY_TIMEOUT_MS}ms, proceeding anyway`);
        break;
      }
      await sleep(1000);
    }

    // Create Phase 5 task contracts
    for (let i = 0; i < PHASE5_TASKS.length; i++) {
      const task = PHASE5_TASKS[i];
      const contract = makeContract({
        id: `gc-${i + 1}`,
        ...task,
      });
      const lease = board.acquireLease(MASTER_NODE_ID, 60_000);
      board.putContract(contract, lease!.fence);
      log(`Created contract gc-${i + 1}: ${task.objective}`);
    }

    // Main orchestration loop - tracks completion via blackboard, NOT worker process
    let iteration = 0;
    while (true) {
      iteration++;
      log(`--- Iteration ${iteration} ---`);

      const lease = board.acquireLease(MASTER_NODE_ID, LEASE_TTL_MS);
      if (!lease) {
        log("Failed to acquire lease, retrying...");
        await sleep(LOOP_INTERVAL_MS);
        continue;
      }
      const currentFence = lease.fence;

      // Update master heartbeat
      board.heartbeat(MASTER_NODE_ID);

      // Scan for pending contracts
      const contracts = board.listContracts();
      const pending = contracts.filter((c) => c.status === "pending");

      if (pending.length === 0) {
        log("No pending contracts, checking for completed/failed...");

        // Run verifier on completed contracts
        const completed = contracts.filter((c) => c.status === "completed");
        for (const contract of completed) {
          logContract(contract);
          if (contract.artifacts.length > 0) {
            log(`  Artifacts: ${contract.artifacts.join(", ")}`);
          }
        }

        // Run orphan recovery
        const recovery = board.runOrphanRecovery();
        if (recovery.recovered > 0 || recovery.requeued > 0) {
          log(`Orphan recovery: ${recovery.recovered} recovered, ${recovery.requeued} requeued`);
        }

        // Check if all work is done via BLACKBOARD (not process state)
        const remaining = board.listContracts().filter((c) => c.status !== "completed" && c.status !== "failed");
        if (remaining.length === 0) {
          log("All work completed!");
          break;
        }
      } else {
        log(`Found ${pending.length} pending contract(s)`);
      }

      // Assign work to planner (self) or implementer (worker)
      for (const contract of pending) {
        if (contract.role === "planner") {
          log(`Running planner for ${contract.id}: ${contract.objective}`);
          const lease2 = board.acquireLease(MASTER_NODE_ID, 60_000);
          if (lease2) {
            const updated = board.updateStatus(
              contract.id,
              "completed",
              MASTER_NODE_ID,
              [`Planned: ${contract.objective}`],
              currentFence,
            );
            if (updated) {
              log(`Planner completed ${contract.id}`);
            }
          }
        } else if (contract.role === "implementer") {
          log(`Assigning implementer for ${contract.id}: ${contract.objective}`);
          // Assign to first available worker
          const nodes = board.getNodes().filter((n) => n.role === "worker" && n.status === "alive");
          if (nodes.length === 0) {
            log("No workers available, will retry next iteration");
            continue;
          }
          const worker = nodes[0];
          const lease2 = board.acquireLease(MASTER_NODE_ID, LEASE_TTL_MS);
          if (lease2) {
            board.updateStatus(
              contract.id,
              "in_progress",
              MASTER_NODE_ID,
              [`Assigned to ${worker.nodeId}`],
              lease2.fence,
            );
            const updated = board.getContract(contract.id);
            if (updated) {
              updated.workerNodeId = worker.nodeId;
              updated.leaseFence = lease2.fence;
              board.putContract(updated, lease2.fence);
              log(`Assigned ${contract.id} to ${worker.nodeId} (fence=${lease2.fence})`);
            }
          }
        }
      }

      board.releaseLease(MASTER_NODE_ID, currentFence);

      // Brief pause before next iteration
      await sleep(LOOP_INTERVAL_MS);
    }
  } catch (error) {
    log(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    log("Cleaning up...");
    rmSync(tmpDir, { recursive: true, force: true });
    log("Master done.");
  }
}


main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});