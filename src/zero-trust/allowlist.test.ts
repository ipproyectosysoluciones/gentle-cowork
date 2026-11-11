/**
 * T5.7 Zero-Trust - Allowlist Attack Tests
 *
 * Rules under test:
 * 1. A worker whose nodeId is not in the allowlist is rejected (error + close).
 * 2. A connection that never registers is closed after the registration timeout.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";

// Test utilities
const WS_PORT = 4319; // Different port to avoid conflicts
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

function sendMessage(ws: WebSocket, msg: unknown): Promise<void> {
	return new Promise((resolve, reject) => {
		if (ws.readyState !== WebSocket.OPEN) {
			reject(new Error("WS not open"));
			return;
		}
		ws.send(JSON.stringify(msg));
		resolve();
	});
}

function waitForMessage(ws: WebSocket, type: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
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

/** Resolves when the connection closes (never rejects on close). */
function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<number> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("Timeout waiting for close")), timeoutMs);
		ws.on("close", (code) => {
			clearTimeout(timeout);
			resolve(code);
		});
	});
}

// We'll import the server after it's created
let serverModule: { startServer: () => Promise<void>; stopServer: () => Promise<void> } | undefined;

describe("T5.7 Zero-Trust - Allowlist Attack Tests", () => {
	beforeAll(async () => {
		// Set the port for this test
		process.env.TEST_PORT = "4319";
		// Dynamic import to allow server code to be written after tests
		const mod = await import("./server.ts");
		serverModule = mod;
		await mod.startServer();
	});

	afterAll(async () => {
		if (serverModule) {
			await serverModule.stopServer();
		}
	});

	describe("Attack: Worker NOT in allowlist", () => {
		it("should reject registration of a worker not in the allowlist", async () => {
			const ws = await connectWS();

			await sendMessage(ws, {
				type: "register",
				role: "worker",
				nodeId: "attacker-not-in-allowlist",
			});

			const error = await waitForMessage(ws, "error");
			expect(error.type).toBe("error");
			expect(String(error.message)).toContain("not in allowlist");

			// The server must also close the rejected connection
			const closeCode = await waitForClose(ws);
			expect(typeof closeCode).toBe("number");
		});

		it("should close a connection that never registers (registration timeout)", async () => {
			const ws = await connectWS();

			// No registration message: the server must close the silent connection
			const closeCode = await waitForClose(ws, 3000);
			expect(typeof closeCode).toBe("number");
		});
	});
});
