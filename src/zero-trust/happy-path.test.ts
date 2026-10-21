/**
 * T5.7 Zero-Trust - Happy Path Tests (GREEN phase)
 *
 * Tests that valid workers can connect and communicate properly.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import { createServer } from "http";
import { generateCertificate } from "./crypto";

// Test utilities
const WS_PORT = 4322; // Different port to avoid conflicts
const WS_BIND = "127.0.0.1";
const WS_URL = `ws://${WS_BIND}:${WS_PORT}`;

function connectWS(options = {}): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(WS_URL, options);
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

describe("T5.7 Zero-Trust - Happy Path Tests", () => {
	beforeAll(async () => {
		// Set the port for this test
		process.env.TEST_PORT = '4322';
		// Dynamic import to allow server code to be written after tests
		serverModule = await import("./server.ts");
		server = await serverModule.startServer();
	});

	afterAll(async () => {
		if (serverModule) {
			await serverModule.stopServer();
		}
	});

	beforeEach(() => {
		// Clear any state between tests if needed
	});

	describe("Happy Path: Valid worker registration", () => {
		it("should allow registered worker to connect and receive welcome", async () => {
			const ws = await connectWS();
			const registerMsg = { type: "register", role: "worker", nodeId: "test-node-1" };
			await sendMessage(ws, registerMsg);
			const welcome = await waitForMessage(ws, "welcome");

			expect(welcome.type).toBe("welcome");
			expect(welcome.protocol).toBe(1); // WS_PROTOCOL_VERSION
			expect(typeof welcome.serverNodeId).toBe("string");

			ws.close();
		});
	});

	describe("Happy Path: Valid role-based communication", () => {
		it("should allow planner to send AssignStep to implementer", async () => {
			const wsPlanner = await connectWS();
			const wsImplementer = await connectWS();

			// Planner registers
			const plannerRegisterMsg = { type: "register", role: "planner", nodeId: "test-planner-1" };
			await sendMessage(wsPlanner, plannerRegisterMsg);
			const plannerWelcome = await waitForMessage(wsPlanner, "welcome");
			expect(plannerWelcome.type).toBe("welcome");

			// Implementer registers
			const implementerRegisterMsg = { type: "register", role: "implementer", nodeId: "test-implementer-1" };
			await sendMessage(wsImplementer, implementerRegisterMsg);
			const implementerWelcome = await waitForMessage(wsImplementer, "welcome");
			expect(implementerWelcome.type).toBe("welcome");

			// Planner sends AssignStep
			const assignStepMsg = { 
				type: "assign_step", 
				contractId: "gc-test-1",
				workerNodeId: "test-implementer-1",
				stepId: "step-1",
				instructions: "Do something"
			};
			await sendMessage(wsPlanner, assignStepMsg);

			// Implementer should receive the AssignStep
			const receivedAssignStep = await waitForMessage(wsImplementer, "assign_step");
			expect(receivedAssignStep.type).toBe("assign_step");
			expect(receivedAssignStep.contractId).toBe("gc-test-1");
			expect(receivedAssignStep.workerNodeId).toBe("test-implementer-1");

			wsPlanner.close();
			wsImplementer.close();
		});

		it("should allow implementer to send StepResult to planner", async () => {
			const wsPlanner = await connectWS();
			const wsImplementer = await connectWS();
			const wsVerifier = await connectWS();

			// Planner registers
			const plannerRegisterMsg = { type: "register", role: "planner", nodeId: "test-planner-2" };
			await sendMessage(wsPlanner, plannerRegisterMsg);
			const plannerWelcome = await waitForMessage(wsPlanner, "welcome");
			expect(plannerWelcome.type).toBe("welcome");

			// Implementer registers
			const implementerRegisterMsg = { type: "register", role: "implementer", nodeId: "test-implementer-2" };
			await sendMessage(wsImplementer, implementerRegisterMsg);
			const implementerWelcome = await waitForMessage(wsImplementer, "welcome");
			expect(implementerWelcome.type).toBe("welcome");

			// Verifier registers
			const verifierRegisterMsg = { type: "register", role: "verifier", nodeId: "test-verifier-1" };
			await sendMessage(wsVerifier, verifierRegisterMsg);
			const verifierWelcome = await waitForMessage(wsVerifier, "welcome");
			expect(verifierWelcome.type).toBe("welcome");

			// First, planner assigns a step to implementer
			const assignStepMsg = { 
				type: "assign_step", 
				contractId: "gc-test-2",
				workerNodeId: "test-implementer-2",
				stepId: "step-2",
				instructions: "Do something else"
			};
			await sendMessage(wsPlanner, assignStepMsg);
			const implementerAssignStep = await waitForMessage(wsImplementer, "assign_step");
			expect(implementerAssignStep.type).toBe("assign_step");

			// Implementer sends StepResult
			const stepResultMsg = { 
				type: "step_result",
				contractId: "gc-test-2",
				workerNodeId: "test-implementer-2",
				stepId: "step-2",
				status: "completed",
				result: "Task completed successfully"
			};
			await sendMessage(wsImplementer, stepResultMsg);

			// Planner should receive the StepResult
			const plannerStepResult = await waitForMessage(wsPlanner, "step_result");
			expect(plannerStepResult.type).toBe("step_result");
			expect(plannerStepResult.contractId).toBe("gc-test-2");
			expect(plannerStepResult.status).toBe("completed");

			wsPlanner.close();
			wsImplementer.close();
			wsVerifier.close();
		});

		it("should allow verifier to receive StepResult", async () => {
			const wsPlanner = await connectWS();
			const wsImplementer = await connectWS();
			const wsVerifier = await connectWS();

			// Planner registers
			const plannerRegisterMsg = { type: "register", role: "planner", nodeId: "test-planner-3" };
			await sendMessage(wsPlanner, plannerRegisterMsg);
			const plannerWelcome = await waitForMessage(wsPlanner, "welcome");
			expect(plannerWelcome.type).toBe("welcome");

			// Implementer registers
			const implementerRegisterMsg = { type: "register", role: "implementer", nodeId: "test-implementer-3" };
			await sendMessage(wsImplementer, implementerRegisterMsg);
			const implementerWelcome = await waitForMessage(wsImplementer, "welcome");
			expect(implementerWelcome.type).toBe("welcome");

			// Verifier registers
			const verifierRegisterMsg = { type: "register", role: "verifier", nodeId: "test-verifier-2" };
			await sendMessage(wsVerifier, verifierRegisterMsg);
			const verifierWelcome = await waitForMessage(wsVerifier, "welcome");
			expect(verifierWelcome.type).toBe("welcome");

			// First, planner assigns a step to implementer
			const assignStepMsg = { 
				type: "assign_step", 
				contractId: "gc-test-3",
				workerNodeId: "test-implementer-3",
				stepId: "step-3",
				instructions: "Do something else"
			};
			await sendMessage(wsPlanner, assignStepMsg);
			const implementerAssignStep = await waitForMessage(wsImplementer, "assign_step");
			expect(implementerAssignStep.type).toBe("assign_step");

			// Implementer sends StepResult
			const stepResultMsg = { 
				type: "step_result",
				contractId: "gc-test-3",
				workerNodeId: "test-implementer-3",
				stepId: "step-3",
				status: "completed",
				result: "Task completed successfully"
			};
			await sendMessage(wsImplementer, stepResultMsg);

			// Verifier should receive the StepResult
			const verifierStepResult = await waitForMessage(wsVerifier, "step_result");
			expect(verifierStepResult.type).toBe("step_result");
			expect(verifierStepResult.contractId).toBe("gc-test-3");
			expect(verifierStepResult.status).toBe("completed");

			wsPlanner.close();
			wsImplementer.close();
			wsVerifier.close();
		});
	});

	describe("Happy Path: Lease management", () => {
		it("should grant lease to allowed worker", async () => {
			const ws = await connectWS();
			const leaseReq = { 
				type: "lease_request", 
				nodeId: "test-worker-lease", 
				role: "worker",
				ttlMs: 30000
			};
			await sendMessage(ws, leaseReq);
			const leaseGrant = await waitForMessage(ws, "lease_grant");

			expect(leaseGrant.granted).toBe(true);
			expect(typeof leaseGrant.fence).toBe("number");
			expect(typeof leaseGrant.expiresAt).toBe("string");

			ws.close();
		});
	});
});