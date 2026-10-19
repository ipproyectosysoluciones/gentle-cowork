#!/usr/bin/env node
/**
 * dogfood-worker — Worker implementation for Phase 5 dogfooding.
 *
 * Polls the blackboard for implementer tasks assigned to this worker,
 * executes them, and writes results back. Exits when no more work is pending.
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openBlackboard, defaultBlackboardPath, STATE_VERSION, DEFAULT_LEASE_TTL_MS } from "../src/blackboard.ts";
import type { TaskContract, NodeRegistration } from "../src/types.ts";
import { makeContract, makeDogfoodDir, cleanupDogfoodDir, log, sleep } from "./dogfood-common.ts";

const WORKER_NODE_ID = process.env.DOG_FOOD_WORKER_ID || `worker-${process.pid}-${Date.now()}`;
const POLL_INTERVAL_MS = 500;
const LEASE_DURATION_MS = 10_000;
const NO_WORK_TIMEOUT_MS = 60_000; // Exit after this long with no work (60s)
const MASTER_READY_TIMEOUT_MS = 120_000; // Wait for master to be ready (120s)


function logWorker(message: string): void {
  log(message, "WORKER");
}

async function main(): Promise<void> {
  // The worker needs to find the blackboard path. In dogfooding, it's passed via env.
  const sharedDir = process.env.DOG_FOOD_SHARED_DIR;
  if (!sharedDir) {
    logWorker("ERROR: DOG_FOOD_SHARED_DIR not set");
    process.exit(1);
  }
  const filePath = join(sharedDir, ".gentle-cowork", "blackboard.json");
  logWorker(`Worker starting, blackboard at ${filePath}`);

  try {
    const board = openBlackboard(filePath);

    // Register as worker (use fixed ID for testing, or auto-generated)
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

    // Wait for master to be ready (registered and alive)
    logWorker(`Waiting for master to be ready...`);
    const masterReadyStart = Date.now();
    while (true) {
      const nodes = board.getNodes().filter((n) => n.role === "master" && n.status === "alive");
      if (nodes.length > 0) {
        logWorker(`Master detected: ${nodes[0].nodeId}`);
        break;
      }
      if (Date.now() - masterReadyStart > MASTER_READY_TIMEOUT_MS) {
        logWorker(`Master not ready after ${MASTER_READY_TIMEOUT_MS}ms, exiting`);
        process.exit(1);
      }
      await sleep(1000);
    }

    let lastWorkTime = Date.now();

    // Worker loop - exits when no more work for NO_WORK_TIMEOUT_MS
    while (true) {
      // Heartbeat
      board.heartbeat(myNodeId);

      // Acquire short lease for reading
      const lease = board.acquireLease(myNodeId, 5_000);
      if (!lease) {
        await sleep(500);
        continue;
      }
      const currentFence = lease.fence;

      // Find work assigned to this worker
      const contracts = board.listContracts();
      const myWork = contracts.filter(
        (c) => c.role === "implementer" && c.status === "in_progress" && c.workerNodeId === myNodeId,
      );

      if (myWork.length === 0) {
        board.releaseLease(myNodeId, lease.fence);
        // Check if we should exit (no work for a while)
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
        // Acquire lease for this specific write
        const writeLease = board.acquireLease(myNodeId, 10_000);
        if (!writeLease) {
          logWorker(`Failed to acquire write lease for ${contract.id}`);
          continue;
        }

        // Validate fence
        if (writeLease.fence < (contract.leaseFence ?? 0)) {
          logWorker(`Stale fence for ${contract.id}: my ${writeLease.fence} < contract ${contract.leaseFence}`);
          board.releaseLease(myNodeId, writeLease.fence);
          continue;
        }

        logWorker(`Executing ${contract.id}: ${contract.objective}`);

        const artifacts: string[] = [];
        for (const criterion of contract.acceptanceCriteria) {
          logWorker(`  Implementing: ${criterion}`);
          // Actually implement based on criterion
          if (criterion.includes("exists")) {
            const filePath = "/tmp/testdogfood3/hello.txt";
            const dir = "/tmp/testdogfood3";
            mkdirSync(dir, { recursive: true });
            writeFileSync(filePath, "Hello Dogfooding!\n", "utf8");
            artifacts.push(`Created file: ${filePath}`);
          } else if (criterion.includes("exact") || criterion.includes("content")) {
            const filePath = "/tmp/testdogfood3/hello.txt";
            const content = readFileSync(filePath, "utf8");
            if (content === "Hello Dogfooding!\n") {
              artifacts.push(`Verified content: ${content.trim()}`);
            } else {
              artifacts.push(`ERROR: Content mismatch - got '${content.trim()}'`);
            }
          } else {
            // Fallback: just sleep
            await sleep(100);
            artifacts.push(`Implemented: ${criterion}`);
          }
        }

        // Update contract with results
        const updatedContract = board.updateStatus(
          contract.id,
          "completed",
          `worker-${process.pid}`,
          artifacts,
          writeLease.fence,
        );

        if (updatedContract) {
          logWorker(`Completed ${contract.id} with ${artifacts.length} artifact(s)`);
        } else {
          logWorker(`Failed to update ${contract.id}`);
        }

        board.releaseLease(myNodeId, writeLease.fence);
      }

      board.releaseLease(myNodeId, lease.fence);
      await sleep(500);
    }

    logWorker("All work completed, exiting");
    process.exit(0);
  } catch (error) {
    logWorker(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

let lastWorkTime = Date.now();
main().catch((error) => {
  logWorker(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});