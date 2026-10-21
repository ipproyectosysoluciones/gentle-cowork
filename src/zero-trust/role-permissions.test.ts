/**
 * T5.7 Zero-Trust - Per-Role Permission Attack Tests (RED phase)
 *
 * Tests that reject workers attempting to perform actions outside their role.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import { createServer } from "http";
import { generateCertificate } from "./crypto";

// Test utilities
const WS_PORT = 4321; // Different port to avoid conflicts
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

describe("T5.7 Zero-Trust - Per-Role Permission Attack Tests", () => {
	beforeAll(async () => {
		// Set the port for this test
		process.env.TEST_PORT = '4321';
		// Dynamic import to allow server code to be written after tests
		serverModule = await import("./server");
		server = await serverModule.startServer();
	});

	afterAll(async () => {
		if (serverModule) {
			await serverModule.stopServer();
		}
	});

	describe("Attack: Role escalation - Implementer sending planner message", () => {
		it("should reject implementer attempting to send AssignStep (planner message)", async () => {
			const ws = await connectWS();

			// Register as implementer
			const registerMsg = {
				type: "register_worker",
				nodeId: "implementer-worker",
				role: "worker",
				capabilities: ["implementer"],
				startedAt: new Date().toISOString(),
			};
			await sendMessage(ws, registerMsg);
			const welcome = await waitForMessage(ws, "welcome");

			// Attempt to send planner message (AssignStep) as implementer
			const assignStepMsg = {
				type: "assign_step",
				contractId: "gc-test-1",
				step: {
					id: "step-1",
					objective: "Test step",
					scope: ["src/test/"],
					acceptanceCriteria: ["test passes"]
				},
				workerNodeId: "implementer-worker"
			};
			await sendMessage(ws, assignStepMsg);

			// Should receive error for unauthorized role escalation
			const error = await waitForMessage(ws, "error");
			expect(error.type).toBe("error");
			expect(error.code).toBe("unauthorized_role");

			ws.close();
		});
	});
});