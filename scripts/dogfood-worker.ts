#!/usr/bin/env node
/**
 * dogfood-worker — Worker implementation for Phase 5 dogfooding.
 *
 * Polls the blackboard for implementer tasks assigned to this worker,
 * executes them, and writes results back.
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openBlackboard, defaultBlackboardPath, STATE_VERSION, DEFAULT_LEASE_TTL_MS } from "../src/blackboard.ts";
import type { TaskContract, NodeRegistration } from "../src/types.ts";
import { makeContract, makeDogfoodDir, cleanupDogfoodDir, log } from "./dogfood-common.ts";

const WORKER_NODE_ID = `worker-${process.pid}-${Date.now()}`;
const POLL_INTERVAL_MS = 500;
const LEASE_DURATION_MS = 10_000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

    // Register as worker
    const workerNode = {
      nodeId: `worker-${process.pid}-${Date.now()}`,
      role: "worker" as const,
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      status: "alive" as const,
    };
    board.registerNode(workerNode);
    const myNodeId = workerNode.nodeId;
    logWorker(`Registered as worker: ${myNodeId}`);

    // Worker loop
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
        await sleep(500);
        continue;
      }

      logWorker(`Found ${myWork.length} task(s) assigned to me`);

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

        // Simulate implementation work
        const artifacts: string[] = [];
        for (const criterion of contract.acceptanceCriteria) {
          logWorker(`  Implementing: ${criterion}`);
          // Simulate work
          await sleep(100);
          artifacts.push(`Implemented: ${criterion}`);
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
  } catch (error) {
    logWorker(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}