/**
 * T5.9 — Remote Worker Slice: launcher library tests.
 *
 * Pure, testable library — NO child_process, NO real ssh.
 * Tests the exact deterministic outputs of the builder functions.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import {
  renderCloudInit,
  buildTunnelCommand,
  buildProvisionCommand,
  buildTeardownCommand,
  verifyRegistration,
  type RemoteWorkerConfig,
} from "./launcher.ts";
import { openBlackboard, defaultBlackboardPath } from "../blackboard.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ============================================================================
// Test constants
// ============================================================================

const BASE_CONFIG: RemoteWorkerConfig = {
  host: "example.com",
  user: "ubuntu",
  keyPath: "/home/user/.ssh/id_ed25519",
  sshPort: 2222,
  image: "my-worker:latest",
  containerName: "my-worker",
  wsPort: 4318,
  tunnelPort: 4318,
  token: "test-token-123",
  env: {
    ANTHROPIC_API_KEY: "sk-ant-test",
    OPENAI_API_KEY: "sk-openai-test",
  },
};

const MINIMAL_CONFIG: RemoteWorkerConfig = {
  host: "server.example.com",
  user: "deploy",
};

// ============================================================================
// renderCloudInit tests
// ============================================================================

describe("renderCloudInit", () => {
  it("produces exact deterministic output for a fixed config", () => {
    const script = renderCloudInit(BASE_CONFIG);

    // Exact full string assertion for determinism
    const expected = `#!/bin/sh
set -eu
# gentle-cowork worker bootstrap (cloud-init user-data style)
# Idempotent: guards with command -v

# Install Docker if missing
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# Create non-root user gcworker if missing
if ! id -u gcworker >/dev/null 2>&1; then
  useradd -m -s /bin/bash gcworker
  usermod -aG docker gcworker
fi

# Create config directory
mkdir -p /etc/gentle-cowork

# Write worker.env with chmod 0600
cat > /etc/gentle-cowork/worker.env <<'EOF'
GENTLE_COWORK_WS_URL=ws://127.0.0.1:4318
ANTHROPIC_API_KEY=sk-ant-test
OPENAI_API_KEY=sk-openai-test
EOF
chmod 0600 /etc/gentle-cowork/worker.env

# Pull and run the worker container
docker pull my-worker:latest
docker run -d --name my-worker --restart unless-stopped --env-file /etc/gentle-cowork/worker.env my-worker:latest
`;

    expect(script).toBe(expected);
  });

  it("uses defaults when optional fields are omitted", () => {
    const script = renderCloudInit(MINIMAL_CONFIG);

    expect(script).toContain("docker pull gentle-cowork-worker:latest");
    expect(script).toContain("docker run -d --name gentle-cowork-worker --restart unless-stopped --env-file /etc/gentle-cowork/worker.env gentle-cowork-worker:latest");
    expect(script).toContain("GENTLE_COWORK_WS_URL=ws://127.0.0.1:4318");
  });

  it("includes only the WS URL when no extra env is provided", () => {
    const config: RemoteWorkerConfig = {
      host: "example.com",
      user: "ubuntu",
      env: {},
    };
    const script = renderCloudInit(config);

    // Should only have the WS URL line (plus the heredoc structure)
    const lines = script.split("\n");
    const envSection = lines.slice(lines.indexOf("cat > /etc/gentle-cowork/worker.env <<'EOF'") + 1);
    const envLines = envSection.slice(0, envSection.indexOf("EOF"));
    expect(envLines).toEqual(["GENTLE_COWORK_WS_URL=ws://127.0.0.1:4318"]);
  });

  it("never embeds env values in any command other than the heredoc", () => {
    const script = renderCloudInit(BASE_CONFIG);

    // The env values should only appear inside the heredoc, not in docker run or other commands
    const dockerRunLine = script.split("\n").find((l) => l.startsWith("docker run"));
    expect(dockerRunLine).not.toContain("sk-ant-test");
    expect(dockerRunLine).not.toContain("sk-openai-test");
    expect(dockerRunLine).toContain("--env-file /etc/gentle-cowork/worker.env");
  });

  it("is idempotent-looking with command -v docker guard", () => {
    const script = renderCloudInit(BASE_CONFIG);
    expect(script).toContain("if ! command -v docker >/dev/null 2>&1;");
    expect(script).toContain("curl -fsSL https://get.docker.com | sh");
    expect(script).toContain("if ! id -u gcworker >/dev/null 2>&1;");
  });

  it("uses custom wsPort and tunnelPort for WS URL", () => {
    const config: RemoteWorkerConfig = {
      ...BASE_CONFIG,
      wsPort: 9999,
      tunnelPort: 8888,
    };
    const script = renderCloudInit(config);
    expect(script).toContain("GENTLE_COWORK_WS_URL=ws://127.0.0.1:8888");
  });
});

// ============================================================================
// buildTunnelCommand tests
// ============================================================================

describe("buildTunnelCommand", () => {
  it("produces exact argv for config with keyPath", () => {
    const argv = buildTunnelCommand(BASE_CONFIG);

    expect(argv).toEqual([
      "ssh",
      "-N",
      "-T",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=4",
      "-i",
      "/home/user/.ssh/id_ed25519",
      "-p",
      "2222",
      "-R",
      "4318:127.0.0.1:4318",
      "ubuntu@example.com",
    ]);
  });

  it("produces exact argv for config without keyPath", () => {
    const argv = buildTunnelCommand(MINIMAL_CONFIG);

    expect(argv).toEqual([
      "ssh",
      "-N",
      "-T",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=4",
      "-p",
      "22",
      "-R",
      "4318:127.0.0.1:4318",
      "deploy@server.example.com",
    ]);
  });

  it("respects custom sshPort, wsPort, tunnelPort", () => {
    const config: RemoteWorkerConfig = {
      ...MINIMAL_CONFIG,
      sshPort: 2222,
      wsPort: 9999,
      tunnelPort: 8888,
    };
    const argv = buildTunnelCommand(config);

    expect(argv).toContain("-p");
    expect(argv).toContain("2222");
    expect(argv).toContain("-R");
    expect(argv).toContain("8888:127.0.0.1:9999");
  });
});

// ============================================================================
// buildProvisionCommand tests
// ============================================================================

describe("buildProvisionCommand", () => {
  it("produces exact argv and stdin matching renderCloudInit", () => {
    const { argv, stdin } = buildProvisionCommand(BASE_CONFIG);

    expect(argv).toEqual([
      "ssh",
      "-i",
      "/home/user/.ssh/id_ed25519",
      "-p",
      "2222",
      "ubuntu@example.com",
      "sh -s",
    ]);

    expect(stdin).toBe(renderCloudInit(BASE_CONFIG));
  });

  it("works without keyPath", () => {
    const { argv, stdin } = buildProvisionCommand(MINIMAL_CONFIG);

    expect(argv).toEqual([
      "ssh",
      "-p",
      "22",
      "deploy@server.example.com",
      "sh -s",
    ]);

    expect(stdin).toBe(renderCloudInit(MINIMAL_CONFIG));
  });
});

// ============================================================================
// buildTeardownCommand tests
// ============================================================================

describe("buildTeardownCommand", () => {
  it("produces exact argv with docker rm -f containerName", () => {
    const argv = buildTeardownCommand(BASE_CONFIG);

    expect(argv).toEqual([
      "ssh",
      "-i",
      "/home/user/.ssh/id_ed25519",
      "-p",
      "2222",
      "ubuntu@example.com",
      "docker rm -f my-worker",
    ]);
  });

  it("uses default containerName when not specified", () => {
    const argv = buildTeardownCommand(MINIMAL_CONFIG);

    expect(argv).toEqual([
      "ssh",
      "-p",
      "22",
      "deploy@server.example.com",
      "docker rm -f gentle-cowork-worker",
    ]);
  });

  it("documents that tunnel teardown is caller-managed (killing local ssh process)", () => {
    // This is a documentation test - the function doesn't return tunnel teardown
    const argv = buildTeardownCommand(BASE_CONFIG);
    // The tunnel is the local ssh -N -T process; caller must kill it
    expect(argv.join(" ")).not.toContain("-N");
    expect(argv.join(" ")).not.toContain("-R");
  });
});

// ============================================================================
// verifyRegistration tests
// ============================================================================

describe("verifyRegistration", () => {
  let tempDir: string;
  let boardPath: string;
  let board: ReturnType<typeof openBlackboard>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gentle-cowork-launcher-test-"));
    boardPath = defaultBlackboardPath(tempDir);
    board = openBlackboard(boardPath);
  });

  afterAll(() => {
    // Note: individual tests clean up their own temp dirs
    // This is just a safety net
  });

  it("green path: resolves with verified ids when both nodes register alive", async () => {
    const nodeIds = ["worker-1", "worker-2"];

    // Register both nodes as alive
    board.registerNode({
      nodeId: "worker-1",
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      status: "alive",
    });
    board.registerNode({
      nodeId: "worker-2",
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      status: "alive",
    });

    const result = await verifyRegistration(board, nodeIds, { timeoutMs: 5000, pollMs: 50 });

    expect(result).toEqual(["worker-1", "worker-2"]);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("timeout path: rejects naming the missing node when only one registers", async () => {
    const nodeIds = ["worker-1", "worker-2"];

    // Register only one node
    board.registerNode({
      nodeId: "worker-1",
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      status: "alive",
    });

    await expect(
      verifyRegistration(board, nodeIds, { timeoutMs: 200, pollMs: 25 }),
    ).rejects.toThrow("registration timeout for: worker-2");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects when nodes register but status is stale", async () => {
    const nodeIds = ["worker-1"];

    board.registerNode({
      nodeId: "worker-1",
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date(Date.now() - 20000).toISOString(), // 20s ago > STALE_THRESHOLD
      status: "stale",
    });

    await expect(
      verifyRegistration(board, nodeIds, { timeoutMs: 200, pollMs: 25 }),
    ).rejects.toThrow("registration timeout for: worker-1");

    rmSync(tempDir, { recursive: true, force: true });
  });
});