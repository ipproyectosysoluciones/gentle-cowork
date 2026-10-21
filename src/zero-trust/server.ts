import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { AllowlistStore } from "./allowlist";
import { validateRoleSend, validateRoleReceive } from "./role-permissions";

let wss: WebSocketServer | null = null;
let allowlistStore: AllowlistStore | null = null;

// Maps for routing
const connections = new Map<string, WebSocket>();
const nodeInfo = new Map<string, { role: string; capabilities: string[] }>();

export async function startServer(): Promise<any> {
  // Initialize allowlist store
  allowlistStore = new AllowlistStore("./allowlist.json");
  
  // Create an HTTP server listening on the expected port
  const server = createServer();
  
  // Create WebSocket server attaching to the HTTP server
  wss = new WebSocketServer({ server });
  
  // Handle WebSocket connections
  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');
    
    // Handle incoming messages
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Received message:', message);
        handleMessage(ws, message);
      } catch (error) {
        console.error('Error processing message:', error);
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });
    
    // Handle connection close
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      for (const [nodeId, wsConn] of connections.entries()) {
        if (wsConn === ws) {
          connections.delete(nodeId);
          nodeInfo.delete(nodeId);
          console.log(`Removed node ${nodeId} from maps`);
          break;
        }
      }
    });
    
    ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
    });
  });
  
  return new Promise<void>((resolve, reject) => {
    const port = parseInt(process.env.TEST_PORT || '4322', 10);
    server.listen(port, "127.0.0.1", () => {
      console.log(`Test server listening on 127.0.0.1:${port}`);
      resolve();
    }).on('error', (err: Error) => {
      console.error('Server error:', err);
      reject(err);
    });
  });
}

function handleMessage(ws: WebSocket, message: any): void {
  const msgType = message.type;
  
  if (msgType === 'register' || msgType === 'register_worker') {
    handleRegistration(ws, message);
  } else if (msgType === 'lease_request') {
    handleLeaseRequest(ws);
  } else if (msgType === 'assign_step') {
    handleAssignStep(ws, message);
  } else if (msgType === 'step_result') {
    handleStepResult(ws, message);
  } else {
    ws.send(JSON.stringify({ error: `Unknown message type: ${msgType}` }));
    console.log('Sent error for unknown message type:', msgType);
  }
}

function handleRegistration(ws: WebSocket, message: any): void {
  const nodeId = message.nodeId;
  const role = message.role;
  const capabilities = message.capabilities || [];
  
  // Check if worker is in allowlist
  if (allowlistStore && !allowlistStore.isAllowed(nodeId)) {
    console.log(`Worker ${nodeId} not in allowlist, rejecting connection`);
    ws.send(JSON.stringify({ 
      type: 'error', 
      error: `Worker ${nodeId} not in allowlist` 
    }));
    ws.close();
    return;
  }
  
  connections.set(message.nodeId, ws);
  nodeInfo.set(message.nodeId, { role: message.role, capabilities: message.capabilities || [] });
  
  const welcomeMessage = {
    type: 'welcome',
    protocol: 1,
    serverNodeId: 'test-server-node-id'
  };
  ws.send(JSON.stringify(welcomeMessage));
  console.log('Sent welcome message:', welcomeMessage);
}

function handleLeaseRequest(ws: WebSocket): void {
  const leaseGrant = {
    type: 'lease_grant',
    granted: true,
    fence: Date.now(),
    expiresAt: new Date(Date.now() + 30000).toISOString()
  };
  ws.send(JSON.stringify(leaseGrant));
  console.log('Sent lease grant:', leaseGrant);
}

function handleAssignStep(ws: WebSocket, message: any): void {
  const senderNodeId = getNodeIdForConnection(ws);
  if (!senderNodeId) {
    ws.send(JSON.stringify({ type: 'error', error: 'Unknown sender' }));
    return;
  }
  
  const senderInfo = nodeInfo.get(senderNodeId);
  if (!senderInfo) {
    ws.send(JSON.stringify({ type: 'error', error: 'Unknown sender' }));
    return;
  }
  
  // Validate sender role can send assign_step
  const sendValidation = validateRoleSend(senderInfo.role, 'assign_step');
  if (!sendValidation.allowed) {
    ws.send(JSON.stringify({ 
      type: 'error', 
              code: "unauthorized_role",
      error: sendValidation.reason 
    }));
    console.log(`Role escalation rejected: ${sendValidation.reason}`);
    return;
  }
  
  const targetNodeId = message.workerNodeId;
  const targetWs = connections.get(message.workerNodeId);
  
  // Validate target can receive assign_step
  const targetInfo = nodeInfo.get(message.workerNodeId);
  if (targetInfo) {
    const receiveValidation = validateRoleReceive(targetInfo.role, 'assign_step');
    if (!receiveValidation.allowed) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: `Target ${message.workerNodeId} cannot receive assign_step: ${receiveValidation.reason}` 
      }));
      return;
    }
  }
  
  if (targetWs && targetWs.readyState === WebSocket.OPEN) {
    targetWs.send(JSON.stringify(message));
    console.log(`Sent AssignStep to worker ${message.workerNodeId}`);
  } else {
    ws.send(JSON.stringify({ 
      type: 'error', 
      error: `Worker not found: ${message.workerNodeId}` 
    }));
    console.log(`Worker ${message.workerNodeId} not found for AssignStep`);
  }
}

function handleStepResult(ws: WebSocket, message: any): void {
  const senderNodeId = getNodeIdForConnection(ws);
  if (!senderNodeId) {
    ws.send(JSON.stringify({ type: 'error', error: 'Unknown sender' }));
    return;
  }
  
  const senderInfo = nodeInfo.get(senderNodeId);
  if (!senderInfo) {
    ws.send(JSON.stringify({ type: 'error', error: 'Unknown sender' }));
    return;
  }
  
  // Validate sender role can send step_result
  const sendValidation = validateRoleSend(senderInfo.role, 'step_result');
  if (!sendValidation.allowed) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      error: sendValidation.reason 
    }));
    console.log(`Role escalation rejected: ${sendValidation.reason}`);
    return;
  }
  
  let sentCount = 0;
  for (const [nodeId, info] of nodeInfo.entries()) {
    if (info.role === 'planner' || info.role === 'verifier') {
      const receiveValidation = validateRoleReceive(info.role, 'step_result');
      if (receiveValidation.allowed) {
        const targetWs = connections.get(nodeId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify(message));
          console.log(`Sent StepResult to ${info.role} ${nodeId}`);
        }
      }
    }
  console.log(`Broadcasted StepResult to planners/verifiers`);
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