#!/usr/bin/env node
/**
 * dogfood-native — Native background job dogfooding using gentle-pi 4.7.0 API.
 *
 * Replaces the custom run-dogfood.sh and launch-remote-worker.ts with
 * native background jobs via Pi's bash_background tool.
 *
 * Usage (via Pi CLI):
 *   pi --mode rpc --no-session -p '{"tool":"bash_background","args":{"command":"npx tsx scripts/dogfood-master.ts","label":"dogfood-master","cwd":"/path/to/project"}}'
 *   pi --mode rpc --no-session -p '{"tool":"bash_background","args":{"command":"npx tsx scripts/dogfood-worker.ts","label":"dogfood-worker","cwd":"/path/to/project"}}'
 *
 * Or as a direct script:
 *   npx tsx scripts/dogfood-native.ts master [--shared-dir PATH] [--timeout SECONDS]
 *   npx tsx scripts/dogfood-native.ts worker [--shared-dir PATH]
 *   npx tsx scripts/dogfood-native.ts run [--timeout SECONDS]
 */

import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openBlackboard, defaultBlackboardPath, STATE_VERSION } from "../src/blackboard.ts";
import type { TaskContract, NodeRegistration } from "../src/types.ts";
import { makeContract, sleep, log, makeDogfoodDir, cleanupDogfoodDir } from "./dogfood-common.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const MASTER_NODE_ID = `master-${process.pid}-${Date.now()}`;
const LEASE_TTL_MS = 30_000;
const ORPHAN_SWEEP_INTERVAL_MS = 10_000;
const LOOP_INTERVAL_MS = 1_000;
const WORKER_READY_TIMEOUT_MS = 120_000;
const MASTER_TIMEOUT_NO_WORKER_MS = 600_000;
const MASTER_GLOBAL_TIMEOUT_MS = 1800_000;

const WORKER_NODE_ID = `worker-${process.pid}-${Date.now()}`;
const POLL_INTERVAL_MS = 500;
const LEASE_DURATION_MS = 10_000;
const NO_WORK_TIMEOUT_MS = 300_000;
const MASTER_READY_TIMEOUT_MS = 120_000;

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

function logWorker(message: string): void {
  console.error(`[${new Date().toISOString()}] [WORKER] ${message}`);
}

async function runMaster(sharedDir: string, timeoutSeconds: number): Promise<number> {
  const filePath = join(sharedDir, ".gentle-cowork", "blackboard.json");
  log(`Dogfood master starting in ${sharedDir} (timeout: ${timeoutSeconds}s)`);

  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  try {
    const board = openBlackboard(join(sharedDir, ".gentle-cowork", "blackboard.json"));

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

    // Wait for at least one worker
    log("Waiting for worker to be ready...");
    const workerReadyStart = Date.now();
    while (true) {
      board.refresh();
      const workers = board.getNodes().filter((n) => n.role === "worker" && n.status === "alive");
      if (workers.length > 0) {
        log(`Worker detected: ${workers[0].nodeId}`);
        break;
      }
      if (Date.now() - workerReadyStart > 120_000) {
        log("Worker not ready after 2 min, exiting");
        return 1;
      }
      await sleep(1000);
    }

    // Create contracts
    for (let i = 0; i < PHASE5_TASKS.length; i++) {
      const task = PHASE5_TASKS[i];
      const contract = makeContract({ id: `gc-${i + 1}`, ...task });
      const lease = board.acquireLease(MASTER_NODE_ID, 60_000);
      board.putContract(contract, lease!.fence);
      log(`Created contract gc-${i + 1}: ${task.objective}`);
    }

    // Main loop
    const masterStartTime = Date.now();
    let iteration = 0;
    let lastWorkerSeenTime = Date.now();

    while (true) {
      if (Date.now() - startTime > timeoutMs) {
        log(`Global timeout reached (${timeoutSeconds}s), exiting`);
        return 1;
      }
      if (Date.now() - masterStartTime > MASTER_GLOBAL_TIMEOUT_MS) {
        log(`Global timeout reached (${MASTER_GLOBAL_TIMEOUT_MS}ms = 30 min), exiting`);
        return 1;
      }
      if (Date.now() - lastWorkerSeenTime > MASTER_TIMEOUT_NO_WORKER_MS) {
        log(`No workers seen for ${MASTER_TIMEOUT_NO_WORKER_MS}ms (10 min), exiting`);
        return 1;
      }

      iteration++;
      log(`--- Iteration ${iteration} ---`);

      board.refresh();
      const lease = board.acquireLease(MASTER_NODE_ID, LEASE_TTL_MS);
      if (!lease) {
        log("Failed to acquire lease, retrying...");
        await sleep(LOOP_INTERVAL_MS);
        continue;
      }
      const currentFence = lease.fence;

      board.heartbeat(MASTER_NODE_ID);

      const contracts = board.listContracts();
      const pending = contracts.filter((c) => c.status === "pending");

      if (pending.length === 0) {
        log("No pending contracts, checking for completed/failed...");

        const completed = contracts.filter((c) => c.status === "completed");
        for (const contract of completed) {
          log(`Contract ${contract.id}: ${contract.objective} [${contract.status}] v${contract.version}`);
          if (contract.artifacts.length > 0) log(`  Artifacts: ${contract.artifacts.join(", ")}`);
        }

        const recovery = board.runOrphanRecovery();
        if (recovery.recovered > 0 || recovery.requeued > 0) {
          log(`Orphan recovery: ${recovery.recovered} recovered, ${recovery.requeued} requeued`);
        }

        const remaining = board.listContracts().filter((c) => c.status !== "completed" && c.status !== "failed");
        if (remaining.length === 0) {
          log("All work completed!");
          break;
        }
      } else {
        log(`Found ${pending.length} pending contract(s)`);
      }

      for (const contract of pending) {
        if (contract.role === "planner") {
          log(`Running planner for ${contract.id}: ${contract.objective}`);
          const lease2 = board.acquireLease(MASTER_NODE_ID, 60_000);
          if (lease2) {
            const updated = board.updateStatus(contract.id, "completed", MASTER_NODE_ID, [`Planned: ${contract.objective}`], currentFence);
            if (updated) log(`Planner completed ${contract.id}`);
          }
        } else if (contract.role === "implementer") {
          log(`Assigning implementer for ${contract.id}: ${contract.objective}`);
          const nodes = board.getNodes().filter((n) => n.role === "worker" && n.status === "alive");
          if (nodes.length === 0) {
            log("No workers available, will retry next iteration");
            continue;
          }
          nodes.sort((a, b) => new Date(b.lastHeartbeat).getTime() - new Date(a.lastHeartbeat).getTime());
          const worker = nodes[0];
          lastWorkerSeenTime = Date.now();
          const lease2 = board.acquireLease(MASTER_NODE_ID, LEASE_TTL_MS);
          if (lease2) {
            board.updateStatus(contract.id, "in_progress", MASTER_NODE_ID, [`Assigned to ${worker.nodeId}`], lease2.fence);
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
      await sleep(LOOP_INTERVAL_MS);
    }
  } catch (error) {
    log(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  log("Master done.");
  return 0;
}

async function runWorker(sharedDir: string): Promise<number> {
  const filePath = join(sharedDir, ".gentle-cowork", "blackboard.json");
  logWorker(`Worker starting, blackboard at ${filePath}`);

  try {
    const board = openBlackboard(filePath);

    const myNodeId = WORKER_NODE_ID;
    const workerNode = {
      nodeId: myNodeId,
      role: "worker" as const,
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      status: "alive" as const,
    };
    board.registerNode(workerNode);
    logWorker(`Registered as worker: ${myNodeId}`);

    logWorker("Waiting for master to be ready...");
    const masterReadyStart = Date.now();
    while (true) {
      board.refresh();
      const nodes = board.getNodes().filter((n) => n.role === "master" && n.status === "alive");
      if (nodes.length > 0) {
        logWorker(`Master detected: ${nodes[0].nodeId}`);
        break;
      }
      if (Date.now() - masterReadyStart > MASTER_READY_TIMEOUT_MS) {
        logWorker("Master not ready, exiting");
        return 1;
      }
      await sleep(1000);
    }

    let lastWorkTime = Date.now();

    while (true) {
      board.refresh();
      board.heartbeat(myNodeId);
      const contracts = board.listContracts();
      const myWork = contracts.filter((c) => c.role === "implementer" && c.status === "in_progress" && c.workerNodeId === myNodeId);

      if (myWork.length === 0) {
        if (Date.now() - lastWorkTime > NO_WORK_TIMEOUT_MS) {
          logWorker("No work for timeout period, exiting gracefully");
          break;
        }
        await sleep(500);
        continue;
      }

      logWorker(`Found ${myWork.length} task(s) assigned to me`);
      lastWorkTime = Date.now();

      for (const contract of myWork) {
        const writeLease = board.acquireLease(myNodeId, 10_000);
        if (!writeLease) continue;
        if (writeLease.fence < (contract.leaseFence ?? 0)) {
          board.releaseLease(myNodeId, writeLease.fence);
          continue;
        }

        logWorker(`Executing ${contract.id}: ${contract.objective}`);

        const artifacts: string[] = [];
        for (const criterion of contract.acceptanceCriteria) {
          logWorker(`  Implementing: ${criterion}`);
          if (criterion.includes("exists")) {
            const filePath = "/tmp/testdogfood3/hello.txt";
            const dir = "/tmp/testdogfood3";
            const { mkdirSync, writeFileSync } = await import("node:fs");
            mkdirSync(dir, { recursive: true });
            writeFileSync(filePath, "Hello Dogfooding!\n", "utf8");
            artifacts.push(`Created file: ${filePath}`);
          } else if (criterion.includes("exact") || criterion.includes("content")) {
            const filePath = "/tmp/testdogfood3/hello.txt";
            const { readFileSync } = await import("node:fs");
            const content = readFileSync(filePath, "utf8");
            if (content === "Hello Dogfooding!\n") {
              artifacts.push(`Verified content: ${content.trim()}`);
            } else {
              artifacts.push(`ERROR: Content mismatch - got '${content.trim()}'`);
            }
          } else {
            await sleep(100);
            artifacts.push(`Implemented: ${criterion}`);
          }
        }

        const updatedContract = board.updateStatus(contract.id, "completed", `worker-${process.pid}`, artifacts, writeLease.fence);
        if (updatedContract) logWorker(`Completed ${contract.id} with ${artifacts.length} artifact(s)`);
        else logWorker(`Failed to update ${contract.id}`);

        board.releaseLease(myNodeId, writeLease.fence);
      }

      await sleep(500);
    }

    logWorker("All work completed, exiting");
    return 0;
  } catch (error) {
    logWorker(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function runBoth(timeoutSeconds: number): Promise<number> {
  // Use a shared temp directory
  const sharedDir = makeDogfoodDir();
  log(`Dogfood native starting in ${sharedDir} (timeout: ${timeoutSeconds}s)`);

  try {
    // Create blackboard directory
    const blackboardDir = join(sharedDir, ".gentle-cowork");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(blackboardDir, { recursive: true });

    // Start master and worker as background processes using child_process
    const { spawn } = await import("node:child_process");

    const masterProc = spawn("npx", ["tsx", "scripts/dogfood-master.ts"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DOG_FOOD_SHARED_DIR: sharedDir },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const workerProc = spawn("npx", ["tsx", "scripts/dogfood-worker.ts"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DOG_FOOD_SHARED_DIR: sharedDir, DOG_FOOD_WORKER_ID: WORKER_NODE_ID },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Prefix output
    masterProc.stdout?.on("data", (d) => console.error(`[MASTER] ${d.toString().trim()}`));
    masterProc.stderr?.on("data", (d) => console.error(`[MASTER] ${d.toString().trim()}`));
    workerProc.stdout?.on("data", (d) => console.error(`[WORKER] ${d.toString().trim()}`));
    workerProc.stderr?.on("data", (d) => console.error(`[WORKER] ${d.toString().trim()}`));

    // Wait for master to complete (it tracks completion via blackboard)
    const masterExitCode = await new Promise<number>((resolve) => {
      masterProc.on("exit", (code) => resolve(code ?? 0));
    });

    // Give worker time to finish gracefully
    await sleep(2000);
    workerProc.kill();

    return masterExitCode;
  } catch (error) {
    log(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    cleanupDogfoodDir(sharedDir);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || "run";
  const timeoutIdx = args.indexOf("--timeout");
  const timeoutSeconds = timeoutIdx >= 0 && args[timeoutIdx + 1] ? parseInt(args[timeoutIdx + 1], 10) : 300;
  const sharedDirIdx = args.indexOf("--shared-dir");
  const sharedDir = sharedDirIdx >= 0 && args[sharedDirIdx + 1] ? args[sharedDirIdx + 1] : undefined;

  let exitCode = 1;

  switch (command) {
    case "master":
      if (!sharedDir) {
        console.error("ERROR: --shared-dir required for master");
        process.exit(1);
      }
      exitCode = await runMaster(sharedDir, timeoutSeconds);
      break;

    case "worker":
      if (!sharedDir) {
        console.error("ERROR: --shared-dir required for worker");
        process.exit(1);
      }
      exitCode = await runWorker(sharedDir);
      break;

    case "run":
      exitCode = await runBoth(timeoutSeconds);
      break;

    default:
      console.error(`Usage: npx tsx scripts/dogfood-native.ts <master|worker|run> [--shared-dir PATH] [--timeout SECONDS]`);
      process.exit(1);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
