/**
 * T5.9 — Remote Worker Slice: launcher library (pure, testable).
 *
 * NO child_process, NO real ssh. Builds exact command argv arrays and
 * cloud-init bootstrap scripts for provisioning a Docker worker container
 * on a remote VPS via SSH reverse tunnel.
 *
 * The master (local) opens `ssh -R <tunnelPort>:127.0.0.1:<wsPort>` to the
 * VPS; the container connects to `ws://127.0.0.1:<tunnelPort>` through the
 * tunnel. Model provider credentials come from the operator's local vault
 * — the launcher only renders them into the env file on the VPS.
 */

import type { Blackboard } from "../blackboard.ts";

/** Configuration for provisioning a remote worker container. */
export interface RemoteWorkerConfig {
  /** SSH target hostname or IP. */
  host: string;
  /** SSH username. */
  user: string;
  /** Path to SSH private key (optional; uses agent/default if omitted). */
  keyPath?: string;
  /** SSH port (default 22). */
  sshPort?: number;
  /** Docker image to run (default "gentle-cowork-worker:latest"). */
  image?: string;
  /** Container name (default "gentle-cowork-worker"). */
  containerName?: string;
  /** Local WS server port the master listens on (default 4318). */
  wsPort?: number;
  /** Remote tunnel port on the VPS (default 4318). Container connects to ws://127.0.0.1:<tunnelPort>. */
  tunnelPort?: number;
  /** Registration token for allowlist (injected into worker.env). */
  token?: string;
  /** Extra environment variables (model provider keys from local vault). */
  env?: Record<string, string>;
}

const DEFAULT_SSH_PORT = 22;
const DEFAULT_IMAGE = "gentle-cowork-worker:latest";
const DEFAULT_CONTAINER_NAME = "gentle-cowork-worker";
const DEFAULT_WS_PORT = 4318;
const DEFAULT_TUNNEL_PORT = 4318;

/** Resolves a config value with its default. */
function get<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

/**
 * Renders a cloud-init user-data style bootstrap script (#!/bin/sh).
 *
 * The script is deterministic and idempotent:
 * - Installs Docker if missing (guard: `command -v docker`)
 * - Creates non-root user `gcworker` if missing
 * - Creates `/etc/gentle-cowork` directory
 * - Writes `/etc/gentle-cowork/worker.env` with chmod 0600 containing:
 *   `GENTLE_COWORK_WS_URL=ws://127.0.0.1:<tunnelPort>` plus every `cfg.env` entry
 * - Runs `docker pull <image>` + `docker run -d --name <containerName> --restart unless-stopped --env-file /etc/gentle-cowork/worker.env <image>`
 *
 * Env values are ONLY embedded in the heredoc — never in any other command.
 */
export function renderCloudInit(cfg: RemoteWorkerConfig): string {
  const image = get(cfg.image, DEFAULT_IMAGE);
  const containerName = get(cfg.containerName, DEFAULT_CONTAINER_NAME);
  const tunnelPort = get(cfg.tunnelPort, DEFAULT_TUNNEL_PORT);

  const envLines = [
    `GENTLE_COWORK_WS_URL=ws://127.0.0.1:${tunnelPort}`,
    ...Object.entries(cfg.env ?? {}).map(([k, v]) => `${k}=${v}`),
  ];

  const envBlock = envLines.join("\n");

  return `#!/bin/sh
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
${envBlock}
EOF
chmod 0600 /etc/gentle-cowork/worker.env

# Pull and run the worker container
docker pull ${image}
docker run -d --name ${containerName} --restart unless-stopped --env-file /etc/gentle-cowork/worker.env ${image}
`;
}

/**
 * Builds the SSH reverse tunnel command argv.
 *
 * The tunnel forwards `<tunnelPort>` on the VPS to `127.0.0.1:<wsPort>` on the master.
 * The container inside the VPS connects to `ws://127.0.0.1:<tunnelPort>`.
 *
 * @returns argv array for `ssh -N -T -R ...`
 */
export function buildTunnelCommand(cfg: RemoteWorkerConfig): string[] {
  const sshPort = get(cfg.sshPort, DEFAULT_SSH_PORT);
  const wsPort = get(cfg.wsPort, DEFAULT_WS_PORT);
  const tunnelPort = get(cfg.tunnelPort, DEFAULT_TUNNEL_PORT);

  const argv: string[] = [
    "ssh",
    "-N",
    "-T",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
  ];

  if (cfg.keyPath) {
    argv.push("-i", cfg.keyPath);
  }

  argv.push("-p", String(sshPort));
  argv.push("-R", `${tunnelPort}:127.0.0.1:${wsPort}`);
  argv.push(`${cfg.user}@${cfg.host}`);

  return argv;
}

/**
 * Builds the provision command that runs the cloud-init script on the VPS.
 *
 * @returns { argv, stdin } where stdin is the exact output of `renderCloudInit(cfg)`.
 */
export function buildProvisionCommand(cfg: RemoteWorkerConfig): { argv: string[]; stdin: string } {
  const sshPort = get(cfg.sshPort, DEFAULT_SSH_PORT);

  const argv: string[] = ["ssh"];

  if (cfg.keyPath) {
    argv.push("-i", cfg.keyPath);
  }

  argv.push("-p", String(sshPort));
  argv.push(`${cfg.user}@${cfg.host}`);
  argv.push("sh -s");

  return { argv, stdin: renderCloudInit(cfg) };
}

/**
 * Builds the teardown command to stop and remove the worker container.
 *
 * Tunnel teardown = killing the local ssh process (the `-N -T` process from
 * `buildTunnelCommand`). The caller owns that process and must terminate it.
 * This function only handles the remote container cleanup.
 */
export function buildTeardownCommand(cfg: RemoteWorkerConfig): string[] {
  const sshPort = get(cfg.sshPort, DEFAULT_SSH_PORT);
  const containerName = get(cfg.containerName, DEFAULT_CONTAINER_NAME);

  const argv: string[] = ["ssh"];

  if (cfg.keyPath) {
    argv.push("-i", cfg.keyPath);
  }

  argv.push("-p", String(sshPort));
  argv.push(`${cfg.user}@${cfg.host}`);
  argv.push(`docker rm -f ${containerName}`);

  return argv;
}

/**
 * Polls the blackboard until EVERY nodeId in `nodeIds` appears with `status === "alive"`.
 *
 * @param board - Blackboard handle (caller must call `board.refresh()` or it's done internally)
 * @param nodeIds - Array of node IDs that must all be registered and alive
 * @param opts.timeoutMs - Total timeout (default 30000)
 * @param opts.pollMs - Poll interval (default 250)
 * @returns Promise resolving with the verified nodeIds array
 * @rejects Error("registration timeout for: <missing ids comma-separated>")
 */
export async function verifyRegistration(
  board: Blackboard,
  nodeIds: string[],
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pollMs = opts.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  const missing = (): string[] => {
    board.refresh();
    const nodes = board.getNodes();
    const aliveIds = new Set(
      nodes.filter((n) => n.status === "alive").map((n) => n.nodeId),
    );
    return nodeIds.filter((id) => !aliveIds.has(id));
  };

  while (true) {
    const stillMissing = missing();
    if (stillMissing.length === 0) {
      return nodeIds;
    }
    if (Date.now() >= deadline) {
      throw new Error(`registration timeout for: ${stillMissing.join(", ")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}