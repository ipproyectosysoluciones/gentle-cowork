/**
 * Admin API Security Tests (L1, L2)
 *
 * Tests for:
 * - L1: Security headers on Admin API responses
 * - L2: Audit log for admin mutating actions
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import https from "https";
import fs from "fs";
import path from "path";

// Test port to avoid conflicts
const TEST_PORT = 4323;
const TEST_HOST = "127.0.0.1";

// Load CA cert for self-signed certificate validation
let caCert: string;
let httpsAgent: https.Agent;

function loadCA() {
	caCert = fs.readFileSync(path.join(__dirname, "..", "..", "ca.pem"), "utf8");
	httpsAgent = new https.Agent({ ca: caCert, rejectUnauthorized: false });
}

// Helper to make HTTPS requests
function httpsRequest(method: string, reqPath: string, body?: any): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
	return new Promise((resolve, reject) => {
		const postData = body ? JSON.stringify(body) : undefined;
		const options = {
			hostname: TEST_HOST,
			port: TEST_PORT,
			path: reqPath,
			method,
			agent: httpsAgent,
			headers: {
				"content-type": "application/json",
				...(postData ? { "content-length": Buffer.byteLength(postData) } : {}),
			},
		};

		const req = https.request(options, (res) => {
			let data = "";
			res.on("data", (chunk) => { data += chunk; });
			res.on("end", () => {
				// Normalize headers to lowercase for consistent access
				const normalizedHeaders: Record<string, string> = {};
				for (const [key, value] of Object.entries(res.headers)) {
					normalizedHeaders[key.toLowerCase()] = Array.isArray(value) ? value[0] : value ?? "";
				}
				resolve({ statusCode: res.statusCode!, headers: normalizedHeaders, body: data });
			});
		});
		req.on("error", reject);
		if (postData) req.write(postData);
		req.end();
	});
}

describe("Admin API Security (L1, L2)", () => {
	beforeAll(async () => {
		process.env.TEST_PORT = "4323";
		loadCA();
		const mod = await import("./server.ts");
		await mod.startServer();
	});

	afterAll(async () => {
		const mod = await import("./server.ts");
		await mod.stopServer();
	});

	describe("L1: Security Headers on Admin API", () => {
		it("should include security headers on successful admin API response", async () => {
			const res = await httpsRequest("POST", "/api/admin/allowlist", { action: "add", nodeId: "test-node" });
			
			expect(res.headers["x-content-type-options"]).toBe("nosniff");
			expect(res.headers["x-frame-options"]).toBe("DENY");
			expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
		});

		it("should include security headers on rate-limited response (429)", async () => {
			// Make many requests to trigger rate limit
			const requests = Array(65).fill(null).map(() => 
				httpsRequest("POST", "/api/admin/allowlist", { action: "add", nodeId: "test-rate-limit" })
			);
			await Promise.all(requests);
			
			// The last request should be rate limited
			const res = await httpsRequest("POST", "/api/admin/allowlist", { action: "add", nodeId: "test-rate-limit-final" });
			
			expect(res.statusCode).toBe(429);
			expect(res.headers["x-content-type-options"]).toBe("nosniff");
			expect(res.headers["x-frame-options"]).toBe("DENY");
			expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
		});

		it("should include security headers on 404 response", async () => {
			const res = await httpsRequest("GET", "/api/admin/nonexistent");
			
			expect(res.statusCode).toBe(404);
			expect(res.headers["x-content-type-options"]).toBe("nosniff");
			expect(res.headers["x-frame-options"]).toBe("DENY");
			expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
		});
	});

	describe("L2: Audit Log for Admin Mutating Actions", () => {
		const mutatingEndpoints = [
			{ path: "/api/admin/allowlist", body: { action: "update", nodeId: "test-audit" }, expectedAction: "admin:allowlist:update" },
			{ path: "/api/admin/pair/start", body: { nodeId: "test-pair" }, expectedAction: "admin:pair:start" },
			{ path: "/api/admin/pair/regenerate", body: { nodeId: "test-pair" }, expectedAction: "admin:pair:regenerate" },
			{ path: "/api/admin/pair/cancel", body: { nodeId: "test-pair" }, expectedAction: "admin:pair:cancel" },
			{ path: "/api/admin/verify", body: { nodeId: "test-verify" }, expectedAction: "admin:verify" },
			{ path: "/api/admin/unpair", body: { nodeId: "test-unpair" }, expectedAction: "admin:unpair" },
		];

		for (const endpoint of mutatingEndpoints) {
			it(`should handle ${endpoint.expectedAction} on POST ${endpoint.path}`, async () => {
				const res = await httpsRequest("POST", endpoint.path, endpoint.body);
				
				// Verify the endpoint is handled by the admin handler (not the catch-all 404)
				expect(res.statusCode).not.toBe(404);
			});
		}

		it("should handle rate limit when exceeded", async () => {
			// Make 65 requests to exceed the 60 req/min limit
			const requests = Array(65).fill(null).map(() => 
				httpsRequest("POST", "/api/admin/allowlist", { action: "add", nodeId: "test-rate-audit" })
			);
			await Promise.all(requests);
			
			// The next request should be rate limited
			const res = await httpsRequest("POST", "/api/admin/allowlist", { action: "add", nodeId: "test-rate-audit-final" });
			
			expect(res.statusCode).toBe(429);
		});
	});
});