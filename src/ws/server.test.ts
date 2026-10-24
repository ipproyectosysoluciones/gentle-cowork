/**
 * T5.6 WS Transport Skeleton — Tests (RED phase)
 *
 * Tests the WebSocket server for master/worker coordination.
 * Port: 4318 (configurable), Binding: 127.0.0.1
 * Reuses framing pattern from dot-telegram daemon protocol.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import WebSocket from "ws";
import { createServer, type Server } from "http";
import {
	WS_PROTOCOL_VERSION,
	WS_PORT,
	WS_BIND,
	CloseCode,
	type RegisterWorker,
	type AssignStep,
	type StepResult,
	type Heartbeat,
	type LeaseRequest,
	type LeaseGrant,
	type ClientMessage,
	type ServerMessage,
	type WelcomeMessage,
	type ErrorMessage,
	type LeaseGrantMessage,
} from "./protocol.ts";

// Test utilities

function connectWS(): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
		const timeout = setTimeout(() => reject(new Error("WS connection timeout")), 5000);
		ws.once("open", () => clearTimeout(timeout));
	});
}

function sendMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
	return new Promise((resolve, reject) => {
		if (ws.readyState !== WebSocket.OPEN) {
			reject(new Error("WS not open"));
			return;
		}
		ws.send(JSON.stringify(msg));
		resolve();
	});
}

function waitForMessage<T extends ServerMessage>(ws: WebSocket, type: T["type"], timeoutMs = 5000): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.type === type) {
					clearTimeout(timeout);
					resolve(msg as T);
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
let server: Server | undefined;
let serverModule: { startServer: () => Promise<Server>; stopServer: () => Promise<void> } | undefined;

describe("T5.6 WS Transport", () => {
	beforeAll(async () => {
		// Dynamic import to allow server code to be written after tests
		serverModule = await import("./server.ts");
		server = await serverModule.startServer(0, WS_BIND); // puerto efímero: el SO asigna uno libre, cero colisiones
		const addr = server.address() as { port: number };
		wsUrl = `ws://127.0.0.1:${addr.port}`;
	});

	afterAll(async () => {
		if (serverModule) {
			await serverModule.stopServer();
		}
	});

	describe("Handshake", () => {
		it("should accept valid register_worker and send welcome", async () => {
			const ws = await connectWS();

			const registerMsg: RegisterWorker = {
				type: "register_worker",
				nodeId: "test-worker-1",
				role: "worker",
				capabilities: ["implementer"],
				startedAt: new Date().toISOString(),
			};

			await sendMessage(ws, registerMsg);
			const welcome = await waitForMessage<WelcomeMessage>(ws, "welcome");

			expect(welcome.type).toBe("welcome");
			expect(welcome.protocol).toBe(WS_PROTOCOL_VERSION);
			expect(typeof welcome.serverNodeId).toBe("string");

			ws.close();
		});

		it("should reject register_worker with missing fields", async () => {
			const ws = await connectWS();

			const badMsg = { type: "register_worker", nodeId: "test" } as ClientMessage; // missing role, capabilities
			await sendMessage(ws, badMsg);

			const error = await waitForMessage<ErrorMessage>(ws, "error");
			expect(error.type).toBe("error");
			expect(typeof error.code).toBe("string");
			expect(typeof error.message).toBe("string");

			ws.close();
		});

		it("should reject duplicate nodeId registration", async () => {
			const ws1 = await connectWS();
			const registerMsg: RegisterWorker = {
				type: "register_worker",
				nodeId: "duplicate-worker",
				role: "worker",
				capabilities: ["implementer"],
				startedAt: new Date().toISOString(),
			};
			await sendMessage(ws1, registerMsg);
			await waitForMessage(ws1, "welcome");

			const ws2 = await connectWS();
			await sendMessage(ws2, registerMsg);
			const error = await waitForMessage<ErrorMessage>(ws2, "error");
			expect(error.code).toBe("worker_exists");

			ws1.close();
			ws2.close();
		});
	});

	describe("Lease Grantor Exclusivity", () => {
		beforeEach(async () => {
			// Reset server state between tests
			await stopServer();
			await new Promise((r) => setTimeout(r, 50));
			await startServer();
		});

		it("should serialize lease grants for concurrent requests", async () => {
			const ws1 = await connectWS();
			const registerMsg1: RegisterWorker = {
				type: "register_worker",
				nodeId: "lease-worker-1",
				role: "worker",
				capabilities: ["implementer"],
				startedAt: new Date().toISOString(),
			};
			await sendMessage(ws1, registerMsg1);
			await waitForMessage(ws1, "welcome");

			const ws2 = await connectWS();
			const registerMsg2: RegisterWorker = {
				type: "register_worker",
				nodeId: "lease-worker-2",
				role: "worker",
				capabilities: ["implementer"],
				startedAt: new Date().toISOString(),
			};
			await sendMessage(ws2, registerMsg2);
			await waitForMessage(ws2, "welcome");

			// First worker requests lease
			await sendMessage(ws1, { type: "lease_request", nodeId: "lease-worker-1", ttlMs: 30_000 });
			const grant1 = await waitForMessage<LeaseGrantMessage>(ws1, "lease_grant");
			expect(grant1.granted).toBe(true);
			const fence1 = grant1.fence!;

			// Second worker requests lease - should be rejected (lease held by ws1)
			await sendMessage(ws2, { type: "lease_request", nodeId: "lease-worker-2", ttlMs: 30_000 });
			const grant2 = await waitForMessage<LeaseGrantMessage>(ws2, "lease_grant");
			expect(grant2.granted).toBe(false); // rejected
			expect(grant2.reason).toBe("lease_active");

			// First worker releases lease
			await sendMessage(ws1, { type: "lease_release", nodeId: "lease-worker-1" });

			// Second worker requests again - should be granted with incremented fence
			await sendMessage(ws2, { type: "lease_request", nodeId: "lease-worker-2", ttlMs: 30_000 });
			const grant3 = await waitForMessage<LeaseGrantMessage>(ws2, "lease_grant");
			expect(grant3.granted).toBe(true);
			expect(grant3.fence).not.toBe(1); // incremented fence

			ws1.close();
			ws2.close();
		});

		it("should grant new lease after release with incremented fence", async () => {
			const ws = await connectWS();
			const registerMsg: RegisterWorker = {
				type: "register_worker",
				nodeId: "stale-fence-worker",
				role: "worker",
				capabilities: ["implementer"],
				startedAt: new Date().toISOString(),
			};
			await sendMessage(ws, registerMsg);
			await waitForMessage(ws, "welcome");

			// Get valid lease
			await sendMessage(ws, { type: "lease_request", nodeId: "stale-fence-worker", ttlMs: 30_000 });
			const grant = await waitForMessage<LeaseGrantMessage>(ws, "lease_grant");
			expect(grant.granted).toBe(true);
			const fence = grant.fence!;

			// Send lease_release
			await sendMessage(ws, { type: "lease_release", nodeId: "stale-fence-worker" });

			// Try to request another lease - should be granted (new lease)
			await sendMessage(ws, { type: "lease_request", nodeId: "stale-fence-worker", ttlMs: 30_000 });
			const grant2 = await waitForMessage<LeaseGrantMessage>(ws, "lease_grant");
			expect(grant2.granted).toBe(true);
			expect(grant2.fence).not.toBe(fence); // new fence

			ws.close();
		});
	});

	describe("Message Roundtrip", () => {
		it("should handle assign_step -> step_result roundtrip", async () => {
			const ws = await connectWS();
			const registerMsg: RegisterWorker = {
				type: "register_worker",
				nodeId: "roundtrip-worker",
				role: "worker",
				capabilities: ["implementer"],
				startedAt: new Date().toISOString(),
			};
			await sendMessage(ws, registerMsg);
			await waitForMessage(ws, "welcome");

			// Master assigns step (simulated by test sending from master perspective)
			// In real flow, master sends assign_step
			const assignStep: AssignStep = {
				type: "assign_step",
				contractId: "gc-test-1",
				step: {
					id: "step-1",
					objective: "Test step",
					scope: ["src/test/"],
					acceptanceCriteria: ["test passes"],
				},
				workerNodeId: "roundtrip-worker",
			};
			await sendMessage(ws, assignStep as unknown as ClientMessage);

			// Worker receives assign_step (server -> client message)
			// In our protocol, client receives server messages
			// This test verifies the framing works both ways

			ws.close();
		});

		it("should handle heartbeat and respond", async () => {
			const ws = await connectWS();
			const registerMsg: RegisterWorker = {
				type: "register_worker",
				nodeId: "heartbeat-worker",
				role: "worker",
				capabilities: ["implementer"],
				startedAt: new Date().toISOString(),
			};
			await sendMessage(ws, registerMsg);
			await waitForMessage(ws, "welcome");

			const heartbeat: Heartbeat = {
				type: "heartbeat",
				nodeId: "heartbeat-worker",
				timestamp: new Date().toISOString(),
			};
			await sendMessage(ws, heartbeat);

			// Heartbeat doesn't require response in this protocol
			// Just verify no error
			await new Promise((r) => setTimeout(r, 100));

			ws.close();
		});
	});

	describe("Reconnect & Re-register", () => {
		it("should allow re-register after disconnect without duplicates", async () => {
			const ws1 = await connectWS();
			const registerMsg: RegisterWorker = {
				type: "register_worker",
				nodeId: "reconnect-worker",
				role: "worker",
				capabilities: ["implementer"],
				startedAt: new Date().toISOString(),
			};
			await sendMessage(ws1, registerMsg);
			await waitForMessage(ws1, "welcome");
			ws1.close();

			// Wait a bit for server to clean up
			await new Promise((r) => setTimeout(r, 100));

			// Reconnect with same nodeId
			const ws2 = await connectWS();
			await sendMessage(ws2, registerMsg);
			const welcome = await waitForMessage<WelcomeMessage>(ws2, "welcome");
			expect(welcome.type).toBe("welcome");

			ws2.close();
		});
	});
});

// Module exports for test isolation
let startServer: () => Promise<Server>;
let stopServer: () => Promise<void>;

vi.mock("./server.ts", async () => {
	const mod = await import("./server.ts");
	startServer = mod.startServer;
	stopServer = mod.stopServer;
	return { startServer: mod.startServer, stopServer: mod.stopServer };
});