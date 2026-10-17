/**
 * gc-master — WebSocket server for the gentle-cowork Master node.
 *
 * Accepts worker connections, dispatches TaskContracts,
 * tracks worker health via heartbeats.
 *
 * Run: node src/master.ts
 * Port: 9400 (configurable via GC_MASTER_PORT)
 */

import { WebSocketServer, WebSocket } from "ws";

const PORT = parseInt(process.env.GC_MASTER_PORT || "9400");
const log = (msg: string) => console.log(`[gc-master] ${new Date().toISOString()} | ${msg}`);

/** A registered worker connection. */
interface Worker {
  id: string;
  socket: WebSocket;
  role: string;
  lastHeartbeat: number;
  busy: boolean;
}

/** Pending task waiting for a worker. */
interface PendingTask {
  id: string;
  contract: any;
  assignedTo?: string;
}

const workers = new Map<WebSocket, Worker>();
const taskQueue: PendingTask[] = [];

const wss = new WebSocketServer({ port: PORT });

log(`Master node listening on port ${PORT}`);

wss.on("connection", (socket, req) => {
  const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const worker: Worker = {
    id: workerId,
    socket,
    role: "unknown",
    lastHeartbeat: Date.now(),
    busy: false,
  };
  workers.set(socket, worker);
  log(`Worker connected: ${workerId} (total: ${workers.size})`);

  socket.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWorkerMessage(socket, worker, msg);
    } catch (err) {
      log(`Invalid message from ${workerId}: ${(err as Error).message}`);
    }
  });

  socket.on("close", () => {
    workers.delete(socket);
    log(`Worker disconnected: ${workerId} (total: ${workers.size})`);
    // Reassign pending tasks from this worker
    reassignTasks(workerId);
  });

  socket.on("error", (err) => {
    log(`Worker ${workerId} error: ${err.message}`);
  });

  // Send welcome
  socket.send(JSON.stringify({ type: "welcome", workerId }));
});

function handleWorkerMessage(socket: WebSocket, worker: Worker, msg: any): void {
  switch (msg.type) {
    case "register":
      worker.role = msg.role || "implementer";
      worker.busy = false;
      log(`Worker registered: ${worker.id} role=${worker.role}`);
      socket.send(JSON.stringify({ type: "registered", workerId: worker.id, role: worker.role }));
      dispatchNext();
      break;

    case "heartbeat":
      worker.lastHeartbeat = Date.now();
      socket.send(JSON.stringify({ type: "heartbeat_ack" }));
      break;

    case "task_result":
      worker.busy = false;
      log(`Task result from ${worker.id}: contract=${msg.contractId} status=${msg.status}`);
      // Store result (in a real system, persist to DB)
      console.log(`[gc-master] RESULT: ${JSON.stringify(msg.result)}`);
      dispatchNext();
      break;

    case "task_accepted":
      worker.busy = true;
      log(`Task accepted by ${worker.id}: ${msg.contractId}`);
      break;

    default:
      log(`Unknown message type from ${worker.id}: ${msg.type}`);
  }
}

function dispatchNext(): void {
  const available = [...workers.values()].filter((w) => !w.busy && w.role !== "unknown");
  if (available.length === 0 || taskQueue.length === 0) return;

  const task = taskQueue.shift()!;
  const worker = available[0];
  worker.busy = true;
  task.assignedTo = worker.id;

  log(`Dispatching task ${task.id} to ${worker.id}`);
  worker.socket.send(JSON.stringify({ type: "task", contract: task.contract }));
}

function reassignTasks(workerId: string): void {
  const orphaned = taskQueue.filter((t) => t.assignedTo === workerId);
  if (orphaned.length > 0) {
    log(`Reassigning ${orphaned.length} tasks from disconnected worker ${workerId}`);
    taskQueue.push(...orphaned.filter((t) => !taskQueue.includes(t)));
  }
}

// Heartbeat check — remove workers that haven't pinged in 30s
setInterval(() => {
  const now = Date.now();
  for (const [socket, worker] of workers) {
    if (now - worker.lastHeartbeat > 30_000) {
      log(`Worker ${worker.id} timed out (last heartbeat: ${new Date(worker.lastHeartbeat).toISOString()})`);
      workers.delete(socket);
      socket.terminate();
    }
  }
}, 15_000);

// API endpoint to submit tasks (for testing)
import http from "node:http";
const httpServer = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/task") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const contract = JSON.parse(body);
        const task: PendingTask = {
          id: `task-${Date.now()}`,
          contract,
        };
        taskQueue.push(task);
        log(`Task queued: ${task.id}`);
        dispatchNext();
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: true, taskId: task.id, queueLength: taskQueue.length }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
  } else if (req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      workers: workers.size,
      queue: taskQueue.length,
      healthy: true,
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

httpServer.listen(PORT + 1, () => {
  log(`HTTP API on port ${PORT + 1} (POST /task, GET /status)`);
});
