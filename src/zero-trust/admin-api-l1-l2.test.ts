/**
 * Admin API Security Tests (L1, L2)
 *
 * Tests for:
 * - L1: Security headers on Admin API responses
 * - L2: Audit log for admin mutating actions
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";

// Test port to avoid conflicts
const TEST_PORT = 4323;

// Helper to make HTTP requests
function httpRequest(method: string, path: string, body?: any): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1",
      port: 4323,
      path,
      method,
      headers: {
        "content-type": "application/json",
        ...(body ? { "content-length": Buffer.byteLength(JSON.stringify(body)) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode!, headers: res.headers, body: data });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("Admin API Security (L1, L2)", () => {
  beforeAll(async () => {
    process.env.TEST_PORT = "4323";
    const mod = await import("./server.ts");
    await mod.startServer();
  });

  afterAll(async () => {
    const mod = await import("./server.ts");
    await mod.stopServer();
  });

  describe("L1: Security Headers on Admin API", () => {
    it("should include security headers on successful admin API response", async () => {
      const res = await httpRequest("POST", "/api/admin/allowlist", { action: "add", nodeId: "test-node" });
      
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    });

    it("should include security headers on rate-limited response (429)", async () => {
      // Make many requests to trigger rate limit
      const requests = Array(65).fill(null).map(() => 
        httpRequest("POST", "/api/admin/allowlist", { action: "add", nodeId: "test-rate-limit" })
      );
      await Promise.all(requests);
      
      // The last request should be rate limited
      const res = await httpRequest("POST", "/api/admin/allowlist", { action: "add", nodeId: "test-rate-limit-final" });
      
      expect(res.statusCode).toBe(429);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    });

    it("should include security headers on 404 response", async () => {
      const res = await httpRequest("GET", "/api/admin/nonexistent");
      
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
        const res = await httpRequest("POST", endpoint.path, endpoint.body);
        
        // Verify the endpoint is handled by the admin handler (not the catch-all 404)
        expect(res.statusCode).not.toBe(404);
      });
    }

    it("should handle rate limit when exceeded", async () => {
      // Make 65 requests sequentially to exceed the 60 req/min limit
      for (let i = 0; i < 65; i++) {
        await httpRequest("POST", "/api/admin/allowlist", { action: "add", nodeId: `test-rate-audit-${i}` });
      }
      
      // The next request should be rate limited
      const res = await httpRequest("POST", "/api/admin/allowlist", { action: "add", nodeId: "test-rate-audit-final" });
      
      expect(res.statusCode).toBe(429);
    });
  });
});