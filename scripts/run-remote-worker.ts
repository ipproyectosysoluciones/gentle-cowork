#!/usr/bin/env node
/**
 * run-remote-worker — Container entrypoint for the remote worker.
 *
 * Reads configuration from environment variables:
 * - GENTLE_COWORK_WS_URL (required): WebSocket URL to connect to (e.g., ws://127.0.0.1:4318)
 * - GENTLE_COWORK_NODE_ID (optional): Unique node identifier; defaults to remote-<hostname>-<pid>
 * - GENTLE_COWORK_EXECUTOR_TIMEOUT_MS (optional): Timeout for step execution in ms
 * - GENTLE_COWORK_PROVIDER (optional): Provider override for the RPC executor
 * - GENTLE_COWORK_MODEL (optional): Model override for the RPC executor
 *
 * Credentials (model provider keys) are expected to be in the env file
 * mounted by the launcher — they are inherited from the container environment.
 */

import { createRpcStepExecutor } from "../src/orchestrator/executor.ts";
import { RemoteWorkerClient } from "../src/orchestrator/remote-worker.ts";
import os from "node:os";

/** Required environment variable names. */
const REQUIRED_ENV = "GENTLE_COWORK_WS_URL";

/** Optional environment variable names. */
const OPTIONAL_NODE_ID = "GENTLE_COWORK_NODE_ID";
const OPTIONAL_TIMEOUT = "GENTLE_COWORK_EXECUTOR_TIMEOUT_MS";
const OPTIONAL_PROVIDER = "GENTLE_COWORK_PROVIDER";
const OPTIONAL_MODEL = "GENTLE_COWORK_MODEL";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[run-remote-worker] FATAL: Required environment variable ${name} is not set`);
    console.error(`[run-remote-worker] The launcher must provide this via the worker.env file on the VPS.`);
    process.exit(1);
  }
  return value;
}

function getOptionalEnv(name: string): string | undefined {
  return process.env[name];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[run-remote-worker] Invalid ${value}, using fallback ${fallback}`);
    return fallback;
  }
  return parsed;
}

async function main(): Promise<void> {
  // Required: WebSocket URL
  const wsUrl = getRequiredEnv(REQUIRED_ENV);

  // Optional: Node ID (default: remote-<hostname>-<pid>)
  const nodeId = getOptionalEnv(OPTIONAL_NODE_ID) ?? `remote-${os.hostname()}-${process.pid}`;

  // Optional: Executor timeout
  const timeoutMs = parsePositiveInt(getOptionalEnv(OPTIONAL_TIMEOUT), 120_000);

  // Optional: Provider/Model overrides for the RPC executor
  const provider = getOptionalEnv(OPTIONAL_PROVIDER);
  const model = getOptionalEnv(OPTIONAL_MODEL);

  console.error(`[run-remote-worker] Starting remote worker: ${nodeId}`);
  console.error(`[run-remote-worker] Connecting to: ${wsUrl}`);
  console.error(`[run-remote-worker] Executor timeout: ${timeoutMs}ms`);
  if (provider) console.error(`[run-remote-worker] Provider override: ${provider}`);
  if (model) console.error(`[run-remote-worker] Model override: ${model}`);

  // Build the RPC step executor (production transport)
  // Provider/model are inherited from container env unless explicitly overridden
  const executor = createRpcStepExecutor({
    timeoutMs,
    provider,
    model,
  });

  // Create and start the remote worker client
  const client = new RemoteWorkerClient({
    url: wsUrl,
    nodeId,
    executor,
    heartbeatMs: 5000,
    reconnectDelayMs: 1000,
  });

  // Graceful shutdown on SIGTERM/SIGINT
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[run-remote-worker] Received ${signal}, shutting down gracefully...`);
    await client.stop();
    console.error(`[run-remote-worker] Shutdown complete`);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Start the client (resolves on welcome)
  await client.start();
  console.error(`[run-remote-worker] Worker registered and ready`);
}

// Run and handle top-level errors
main().catch((error) => {
  console.error(`[run-remote-worker] Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});