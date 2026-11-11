/**
 * T5.7 Zero-Trust - Protocol-Level Attack Tests
 *
 * The local slice runs plain WebSocket (TLS is deferred to the remote slice —
 * records L13/L15). These tests pin the protocol-level rejection behavior that
 * the local slice actually provides:
 *  - malformed JSON input gets a protocol error response, and the server keeps running.
 *
 * The TLS-handshake attack tests (invalid / expired / attacker self-signed
 * certificates) are deferred with the remote slice: they belong to the mTLS
 * handshake, which does not exist locally. They are recorded as explicit TODOs
 * so the deferred surface stays visible instead of silently green.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";

// Test utilities
const WS_PORT = 4320; // Different port to avoid conflicts
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

// We'll import the server after it's created
let serverModule: { startServer: () => Promise<void>; stopServer: () => Promise<void> } | undefined;

describe("T5.7 Zero-Trust - Protocol-Level Attack Tests", () => {
	beforeAll(async () => {
		// Set the port for this test
		process.env.TEST_PORT = "4320";
		const mod = await import("./server.ts");
		serverModule = mod;
		await mod.startServer();
	});

	afterAll(async () => {
		if (serverModule) {
			await serverModule.stopServer();
		}
	});

	it("should respond with a protocol error to malformed JSON input", async () => {
		const ws = await connectWS();

		// Malformed input must produce an error message, not a crash or silence
		ws.send("invalid json");

		const error = await waitForMessage(ws, "error");
		expect(error.type).toBe("error");
		ws.close();
	});

	it.todo("should reject TLS handshake with an invalid certificate (deferred — remote slice, mTLS)");
	it.todo("should reject TLS handshake with an expired certificate (deferred — remote slice, mTLS)");
	it.todo("should reject TLS handshake with an attacker self-signed certificate (deferred — remote slice, mTLS)");
});
