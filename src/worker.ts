/**
 * gc-worker — WebSocket client for the gentle-cowork Worker node.
 *
 * Connects to the Master node, receives TaskContracts,
 * executes them, and reports results.
 *
 * Run: node src/worker.ts
 * Env: GC_MASTER_URL (default: ws://gc-master:9400)
 */

import { WebSocket } from "ws";

const MASTER_URL = process.env.GC_MASTER_URL || "ws://gc-master:9400";
const WORKER_ROLE = process.env.GC_WORKER_ROLE || "implementer";
const HEARTBEAT_MS = 10_000;

const log = (msg: string) => console.log(`[gc-worker] ${new Date().toISOString()} | ${msg}`);

let socket: WebSocket | null = null;
let reconnectDelay = 1_000;
let heartbeatInterval: NodeJS.Timeout | null = null;
let connected = false;

function connect(): void {
  log(`Connecting to Master at ${MASTER_URL}...`);
  socket = new WebSocket(MASTER_URL);

  socket.on("open", () => {
    log("Connected to Master");
    connected = true;
    reconnectDelay = 1_000;

    // Register with our role
    socket!.send(JSON.stringify({ type: "register", role: WORKER_ROLE }));

    // Start heartbeat
    heartbeatInterval = setInterval(() => {
      socket!.send(JSON.stringify({ type: "heartbeat" }));
    }, HEARTBEAT_MS);
  });

  socket.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMasterMessage(msg);
    } catch (err) {
      log(`Invalid message from Master: ${(err as Error).message}`);
    }
  });

  socket.on("close", () => {
    log("Disconnected from Master");
    connected = false;
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    reconnect();
  });

  socket.on("error", (err) => {
    log(`Connection error: ${err.message}`);
  });
}

function reconnect(): void {
  log(`Reconnecting in ${reconnectDelay / 1000}s...`);
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    connect();
  }, reconnectDelay);
}

function handleMasterMessage(msg: any): void {
  switch (msg.type) {
    case "welcome":
      log(`Welcome from Master. My ID: ${msg.workerId}`);
      break;

    case "registered":
      log(`Registered as ${msg.workerId} with role ${msg.role}`);
      break;

    case "heartbeat_ack":
      // Master is alive
      break;

    case "task":
      log(`Received task: ${msg.contract?.id || "unknown"}`);
      executeTask(msg.contract);
      break;

    default:
      log(`Unknown message type: ${msg.type}`);
  }
}

/**
 * Executes a TaskContract. In the current prototype, this simulates
 * execution by logging the contract details. In the full implementation,
 * this would spawn a pi --mode rpc subagent with the assigned role.
 */
function executeTask(contract: any): void {
  log(`Executing task: ${contract.id} (role: ${contract.role})`);
  log(`  objective: ${contract.objective}`);
  log(`  scope: ${JSON.stringify(contract.scope)}`);
  log(`  specRef: ${contract.specRef}`);

  // Simulate execution
  const result = {
    contractId: contract.id,
    role: contract.role,
    status: "completed",
    artifacts: [
      `Simulated artifact for ${contract.objective}`,
    ],
    summary: `Task ${contract.id} completed by ${WORKER_ROLE} worker`,
  };

  // Report result to Master
  if (socket && connected) {
    socket.send(JSON.stringify({
      type: "task_result",
      contractId: contract.id,
      status: "completed",
      result,
    }));
    log(`Result reported for ${contract.id}`);
  }
}

// Graceful shutdown
process.on("SIGTERM", () => {
  log("Shutting down...");
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  socket?.close();
  process.exit(0);
});

// Start
connect();
