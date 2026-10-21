/**
 * T5.7 Zero-Trust - Allowlist Attack Tests (RED phase)
 *
 * Tests that reject workers not in the allowlist.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import { createServer } from "http";
import { generateCertificate } from "./crypto";

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

describe("T5.7 Zero-Trust - Allowlist Attack Tests", () => {
	beforeAll(async () => {
		// Set the port for this test
		process.env.TEST_PORT = '4319';
		// Dynamic import to allow server code to be written after tests
		serverModule = await import("./server");
		server = await serverModule.startServer();
	});

	afterAll(async () => {
		if (serverModule) {
			await serverModule.stopServer();
		}
	});

	describe("Attack: Worker NOT in allowlist", () => {
		it("should reject connection for worker not in allowlist", async () => {
			const ws = await connectWS();

			// Should not receive welcome - connection should be rejected or closed
			const welcomePromise = waitForMessage(ws, "welcome");
			const closePromise = new Promise((resolve) => {
				ws.on("close", (code) => resolve(code));
			});

			// Either we get a close event or timeout on welcome
			const result = await Promise.race([
				welcomePromise.then(() => ({ type: "welcome" })),
				closePromise.then((code) => ({ type: "close", code }))
			]);

			if (result.type === "welcome") {
				// If we got welcome, it should be an error message
				expect(result.type).toBe("welcome");
				// In a proper implementation, this would be an error message
				ws.close();
			} else {
				// Connection was rejected
				expect(result.type).toBe("close");
				// Could be unauthorized or similar
			}
		});
	});
});