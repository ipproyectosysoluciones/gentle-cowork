/**
 * T5.7 Zero-Trust - Per-Role Permission Attack Tests (RED phase)
 *
 * Tests that reject workers attempting to perform actions outside their role.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import https from "https";
import fs from "fs";
import path from "path";

// Test utilities
const WS_PORT = 4321; // Different port to avoid conflicts
const WS_BIND = "127.0.0.1";
const WS_URL = `wss://${WS_BIND}:${WS_PORT}`;

// Load CA cert for self-signed certificate validation
let caCert: string;
let httpsAgent: https.Agent;

function loadCA() {
	caCert = fs.readFileSync(path.join(__dirname, "..", "..", "ca.pem"), "utf8");
	httpsAgent = new https.Agent({ ca: caCert, rejectUnauthorized: false });
}

function connectWS(options = {}): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(WS_URL, { ...options, agent: httpsAgent });
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
		const timeout = setTimeout(() => reject(new Error("WS connection timeout")), 5000);
		ws.once("open", () => clearTimeout(timeout));
	});
}

function sendMessage(ws: WebSocket, msg: any): Promise<void> {
	return new Promise((resolve, reject) => {
		if (ws.readyState !== WebSocket.OPEN) {
			reject(new Error("WS not open"));
			return;
		}
		ws.send(JSON.stringify(msg));
		resolve();
	});
}

function waitForMessage(ws: WebSocket, type: string, timeoutMs = 5000): Promise<any> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.type === type) {
					clearTimeout(timeout);
					resolve(msg);
				}
			} catch {
				// ignore parse errors
			}
		});
		ws.on("error", reject);
		ws.on("close", () => reject(new Error("WS closed unexpectedly")));
	});
}

// We'll import the server after it's created
let server: any;
let serverModule: { startServer: () => Promise<any>; stopServer: () => Promise<void> } | undefined;

describe("T5.7 Zero-Trust - Per-Role Permission Attack Tests", () => {
	beforeAll(async () => {
		// Set the port for this test
		process.env.TEST_PORT = "4321";
		// Dynamic import to allow server code to be written after tests
		serverModule = await import("./server.ts");
		await serverModule.startServer();
		// Load CA cert AFTER server starts (server writes ca.pem)
		loadCA();
	});

	afterAll(async () => {
		if (serverModule) {
			await serverModule.stopServer();
		}
	});

	describe("Attack: Role escalation - Implementer sending planner message", () => {
		it("should reject implementer attempting to send AssignStep (planner message)", async () => {
			const ws = await connectWS();
			const msg = { type: "register", role: "implementer", nodeId: "test-implementer-1" };
			await sendMessage(ws, msg);
			const welcome = await waitForMessage(ws, "welcome");
			expect(welcome.type).toBe("welcome");

			// Implementer tries to send AssignStep (planner-only message)
			const assignStepMsg = {
				type: "assign_step",
				contractId: "gc-test-1",
				workerNodeId: "test-implementer-2",
				stepId: "step-1",
				instructions: "Do something"
			};
			await sendMessage(ws, assignStepMsg);

			const error = await waitForMessage(ws, "error");
			expect(error.type).toBe("error");
			expect(error.code).toBe("unauthorized_role");
			ws.close();
		});
	});

	describe("Attack: Role escalation - Worker sending planner message", () => {
		it("should reject worker attempting to send AssignStep (planner-only message)", async () => {
			const ws = await connectWS();
			const msg = { type: "register", role: "worker", nodeId: "test-worker-1" };
			await sendMessage(ws, msg);
			const welcome = await waitForMessage(ws, "welcome");
			expect(welcome.type).toBe("welcome");

			// Worker tries to send AssignStep (planner-only message)
			const assignStepMsg = {
				type: "assign_step",
				contractId: "gc-test-1",
				workerNodeId: "test-worker-1",
				stepId: "step-1",
				instructions: "Do something"
			};
			await sendMessage(ws, assignStepMsg);

			const error = await waitForMessage(ws, "error");
			expect(error.type).toBe("error");
			expect(error.code).toBe("unauthorized_role");
			ws.close();
		});
	});

	describe("Attack: Role escalation - Planner sending worker message", () => {
		it("should reject planner attempting to send StepResult (worker message)", async () => {
			const ws = await connectWS();
			const msg = { type: "register", role: "planner", nodeId: "test-planner-1" };
			await sendMessage(ws, msg);
			const welcome = await waitForMessage(ws, "welcome");
			expect(welcome.type).toBe("welcome");

			// Planner tries to send StepResult (worker-only message)
			const stepResultMsg = {
				type: "step_result",
				contractId: "gc-test-1",
				workerNodeId: "test-worker-1",
				stepId: "step-1",
				status: "completed",
				result: "Task completed"
			};
			await sendMessage(ws, stepResultMsg);

			const error = await waitForMessage(ws, "error");
			expect(error.type).toBe("error");
			expect(error.code).toBe("unauthorized_role");
			ws.close();
		});
	});

	describe("Attack: Unregistered worker sending messages", () => {
		it("should reject messages from unregistered worker", async () => {
			const ws = await connectWS();
			// Don't register, just send a message
			const msg = { type: "step_result", contractId: "gc-test" };
			await sendMessage(ws, msg);

			const error = await waitForMessage(ws, "error");
			expect(error.type).toBe("error");
			expect(String(error.message)).toContain("unknown_sender");
			ws.close();
		});
	});

	describe("Allowed: Worker/Implementer can send lease_request", () => {
		it("should allow implementer to send lease_request", async () => {
			const ws = await connectWS();
			const msg = { type: "register", role: "implementer", nodeId: "test-implementer-1" };
			await sendMessage(ws, msg);
			const welcome = await waitForMessage(ws, "welcome");
			expect(welcome.type).toBe("welcome");

			// Implementer sends lease_request (should be allowed)
			const leaseReq = { type: "lease_request", nodeId: "test-implementer-1", role: "worker", ttlMs: 30000 };
			await sendMessage(ws, leaseReq);
			const leaseGrant = await waitForMessage(ws, "lease_grant");
			expect(leaseGrant.granted).toBe(true);
			ws.close();
		});
	});
});