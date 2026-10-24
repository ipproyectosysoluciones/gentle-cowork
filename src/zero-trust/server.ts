import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { AllowlistStore } from "./allowlist.ts";
import { validateRoleSend, validateRoleReceive } from "./role-permissions.ts";

/** Identity advertised in every welcome message. */
const SERVER_NODE_ID = `zero-trust-server-${process.pid}`;

/** Upper bound on concurrent connections (DoS hardening). */
const MAX_CONNECTIONS = 1000;

/** A client must register within this window or the connection is closed. */
const REGISTRATION_TIMEOUT_MS = 1000;

let wss: WebSocketServer | null = null;
let allowlistStore: AllowlistStore | null = null;

// Maps for routing
const connections = new Map<string, WebSocket>();
const nodeInfo = new Map<string, { role: string; capabilities: string[] }>();

/** Sends a protocol-shaped error message to a client. */
function sendError(ws: WebSocket, code: string, message: string): void {
  ws.send(JSON.stringify({ type: "error", code, message }));
}

export async function startServer(): Promise<void> {
  // Initialize allowlist store
  allowlistStore = new AllowlistStore("./allowlist.json");

  // Create an HTTP server listening on the expected port
  const server = createServer();

  // Create WebSocket server attaching to the HTTP server
  wss = new WebSocketServer({ server });

  // Handle WebSocket connections
  wss.on("connection", (ws: WebSocket) => {
    // Reject connections over the capacity limit
    if (connections.size >= MAX_CONNECTIONS) {
      sendError(ws, "server_at_capacity", "Server at capacity");
      ws.close();
      return;
    }

    // Registration timeout: a connection that never registers is closed.
    let registered = false;
    const registrationTimeout = setTimeout(() => {
      if (!registered) {
        sendError(ws, "registration_timeout", "Registration timeout - no registration message received");
        ws.close();
      }
    }, REGISTRATION_TIMEOUT_MS);

    ws.on("message", (data: Buffer) => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        sendError(ws, "bad_message", "Invalid message format");
        return;
      }
      try {
        const type = (message as Record<string, unknown>).type;
        if (type === "register" || type === "register_worker") {
          registered = true;
          clearTimeout(registrationTimeout);
        }
        handleMessage(ws, message);
      } catch (error) {
        sendError(ws, "handler_error", error instanceof Error ? error.message : String(error));
      }
    });

    // Handle connection close
    ws.on("close", () => {
      clearTimeout(registrationTimeout);
      for (const [nodeId, wsConn] of connections.entries()) {
        if (wsConn === ws) {
          connections.delete(nodeId);
          nodeInfo.delete(nodeId);
          break;
        }
      }
    });

    ws.on("error", (error: Error) => {
      console.error("WebSocket error:", error);
    });
  });

  return new Promise<void>((resolve, reject) => {
    const port = parseInt(process.env.TEST_PORT || "4322", 10);
    server.listen(port, "127.0.0.1", () => {
      resolve();
    }).on("error", (err: Error) => {
      reject(err);
    });
  });
}

function handleMessage(ws: WebSocket, message: unknown): void {
  const msgType = (message as Record<string, unknown>).type;

  if (msgType === "register" || msgType === "register_worker") {
    handleRegistration(ws, message as Record<string, unknown>);
  } else if (msgType === "lease_request") {
    handleLeaseRequest(ws);
  } else if (msgType === "assign_step") {
    handleAssignStep(ws, message as Record<string, unknown>);
  } else if (msgType === "step_result") {
    handleStepResult(ws, message as Record<string, unknown>);
  } else {
    sendError(ws, "unknown_type", `Unknown message type: ${String(msgType)}`);
  }
}

function handleRegistration(ws: WebSocket, message: Record<string, unknown>): void {
  const nodeId = message.nodeId as string;
  const role = message.role as string;
  const capabilities = (message.capabilities as string[] | undefined) ?? [];

  if (typeof nodeId !== "string" || nodeId.length === 0) {
    sendError(ws, "bad_registration", "Registration requires a nodeId");
    return;
  }

  // Check if worker is in allowlist
  if (allowlistStore && !allowlistStore.isAllowed(nodeId)) {
    sendError(ws, "not_allowlisted", `Worker ${nodeId} not in allowlist`);
    ws.close();
    return;
  }

  // Duplicate registration replaces the old connection
  if (connections.has(nodeId)) {
    const oldWs = connections.get(nodeId);
    if (oldWs && oldWs.readyState === WebSocket.OPEN) {
      oldWs.close();
    }
  }

  connections.set(nodeId, ws);
  nodeInfo.set(nodeId, { role, capabilities });

  const welcomeMessage = {
    type: "welcome",
    protocol: 1,
    serverNodeId: SERVER_NODE_ID,
  };
  ws.send(JSON.stringify(welcomeMessage));
}

function handleLeaseRequest(ws: WebSocket): void {
  const leaseGrant = {
    type: "lease_grant",
    granted: true,
    fence: Date.now(),
    expiresAt: new Date(Date.now() + 30000).toISOString(),
  };
  ws.send(JSON.stringify(leaseGrant));
}

function handleAssignStep(ws: WebSocket, message: Record<string, unknown>): void {
  const senderNodeId = getNodeIdForConnection(ws);
  if (!senderNodeId) {
    sendError(ws, "unknown_sender", "Unknown sender");
    return;
  }

  const senderInfo = nodeInfo.get(senderNodeId);
  if (!senderInfo) {
    sendError(ws, "unknown_sender", "Unknown sender");
    return;
  }

  // Validate sender role can send assign_step
  const sendValidation = validateRoleSend(senderInfo.role, "assign_step");
  if (!sendValidation.allowed) {
    sendError(ws, "unauthorized_role", sendValidation.reason ?? "Role not authorized");
    return;
  }

  const targetNodeId = message.workerNodeId as string;
  const targetWs = connections.get(targetNodeId);

  // Validate target can receive assign_step
  const targetInfo = nodeInfo.get(targetNodeId);
  if (targetInfo) {
    const receiveValidation = validateRoleReceive(targetInfo.role, "assign_step");
    if (!receiveValidation.allowed) {
      sendError(
        ws,
        "unauthorized_target",
        `Target ${targetNodeId} cannot receive assign_step: ${receiveValidation.reason}`,
      );
      return;
    }
  }

  if (targetWs && targetWs.readyState === WebSocket.OPEN) {
    targetWs.send(JSON.stringify(message));
  } else {
    sendError(ws, "worker_not_found", `Worker not found: ${targetNodeId}`);
  }
}

function handleStepResult(ws: WebSocket, message: Record<string, unknown>): void {
  const senderNodeId = getNodeIdForConnection(ws);
  if (!senderNodeId) {
    sendError(ws, "unknown_sender", "Unknown sender");
    return;
  }

  const senderInfo = nodeInfo.get(senderNodeId);
  if (!senderInfo) {
    sendError(ws, "unknown_sender", "Unknown sender");
    return;
  }

  // Validate sender role can send step_result
  const sendValidation = validateRoleSend(senderInfo.role, "step_result");
  if (!sendValidation.allowed) {
    sendError(ws, "unauthorized_role", sendValidation.reason ?? "Role not authorized");
    return;
  }

  // Broadcast to planners and verifiers allowed to receive it
  for (const [nodeId, info] of nodeInfo.entries()) {
    if (info.role === "planner" || info.role === "verifier") {
      const receiveValidation = validateRoleReceive(info.role, "step_result");
      if (receiveValidation.allowed) {
        const targetWs = connections.get(nodeId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify(message));
        }
      }
    }
  }
}

function getNodeIdForConnection(ws: WebSocket): string | null {
  for (const [nodeId, wsConn] of connections.entries()) {
    if (wsConn === ws) {
      return nodeId;
    }
  }
  return null;
}

export async function stopServer(): Promise<void> {
  if (wss) {
    wss.clients.forEach((client) => {
      client.terminate();
    });
    wss.close();
    wss = null;
  }
  connections.clear();
  nodeInfo.clear();
  allowlistStore = null;
}

export { wss };
