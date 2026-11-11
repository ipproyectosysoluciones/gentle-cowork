#!/usr/bin/env node
/**
 * launch-remote-worker — Operator CLI to provision and manage a remote worker container.
 *
 * Flags:
 *   --host <string>           SSH target hostname or IP (required for launch)
 *   --user <string>           SSH username (required for launch)
 *   --key <string>            Path to SSH private key (optional)
 *   --ssh-port <number>       SSH port (default: 22)
 *   --ws-port <number>        Local WS server port (default: 4318)
 *   --tunnel-port <number>    Remote tunnel port on VPS (default: 4318)
 *   --image <string>          Docker image (default: gentle-cowork-worker:latest)
 *   --container <string>      Container name (default: gentle-cowork-worker)
 *   --token <string>          Registration token for allowlist (optional)
 *   --blackboard <path>       Path to blackboard file (required for launch)
 *   --timeout-ms <number>     Registration verification timeout in ms (default: 30000)
 *   --env <KEY=VALUE>         Extra environment variables (repeatable)
 *   --expected-node <string>  Expected nodeId for registration verification (optional)
 *   --teardown                Run teardown instead of launch
 *   --help                    Print usage and exit
 *
 * Behavior (launch):
 *   1. Validates --host and --user are provided
 *   2. Builds RemoteWorkerConfig from flags
 *   3. Prints provision command summary
 *   4. Runs provision via spawnSync (fails non-zero on error, prints stderr)
 *   5. Spawns SSH reverse tunnel in background, writes PID to <blackboardDir>/remote-tunnel.pid
 *   6. Verifies registration via verifyRegistration (if --expected-node provided)
 *   7. Prints final summary
 *
 * Behavior (teardown):
 *   1. Runs teardown command via spawnSync (fails non-zero on error)
 *   2. Kills tunnel PID from pid file if exists (SIGTERM, ignore already-dead)
 *   3. Removes pid file
 */

import { spawnSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { openBlackboard, defaultBlackboardPath } from "../src/blackboard.ts";
import {
  type RemoteWorkerConfig,
  renderCloudInit,
  buildTunnelCommand,
  buildProvisionCommand,
  buildTeardownCommand,
  verifyRegistration,
} from "../src/orchestrator/launcher.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

interface ParsedArgs {
  host?: string;
  user?: string;
  key?: string;
  sshPort?: number;
  wsPort?: number;
  tunnelPort?: number;
  image?: string;
  container?: string;
  token?: string;
  blackboard?: string;
  timeoutMs?: number;
  env: Record<string, string>;
  expectedNode?: string;
  teardown: boolean;
  help: boolean;
}

const DEFAULTS = {
  sshPort: 22,
  wsPort: 4318,
  tunnelPort: 4318,
  image: "gentle-cowork-worker:latest",
  container: "gentle-cowork-worker",
  timeoutMs: 30_000,
} as const;

function printUsage(): void {
  console.log(`launch-remote-worker — Provision and manage a remote worker container

Usage:
  launch-remote-worker [options]              # Launch (default)
  launch-remote-worker --teardown [options]   # Teardown

Options:
  --host <string>           SSH target hostname or IP (required for launch)
  --user <string>           SSH username (required for launch)
  --key <string>            Path to SSH private key (optional)
  --ssh-port <number>       SSH port (default: 22)
  --ws-port <number>        Local WS server port (default: 4318)
  --tunnel-port <number>    Remote tunnel port on VPS (default: 4318)
  --image <string>          Docker image (default: gentle-cowork-worker:latest)
  --container <string>      Container name (default: gentle-cowork-worker)
  --token <string>          Registration token for allowlist (optional)
  --blackboard <path>       Path to blackboard file (required for launch)
  --timeout-ms <number>     Registration verification timeout in ms (default: 30000)
  --env <KEY=VALUE>         Extra environment variables (repeatable)
  --expected-node <string>  Expected nodeId for registration verification (optional)
  --teardown                Run teardown instead of launch
  --help                    Print this usage and exit

Environment variables (for launch):
  The --env flags are written to the worker.env file on the VPS.
  Common keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GENTLE_COWORK_PROVIDER, GENTLE_COWORK_MODEL

Examples:
  # Launch a worker
  npx tsx scripts/launch-remote-worker.ts \\
    --host 1.2.3.4 --user root --key ~/.ssh/id_ed25519 \\
    --blackboard /path/to/project/.gentle-cowork/blackboard.json \\
    --env ANTHROPIC_API_KEY=sk-ant-... \\
    --token worker-token-123

  # Teardown
  npx tsx scripts/launch-remote-worker.ts --teardown \\
    --host 1.2.3.4 --user root --key ~/.ssh/id_ed25519 \\
    --blackboard /path/to/project/.gentle-cowork/blackboard.json`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    env: {},
    teardown: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--host": args.host = argv[++i]; break;
      case "--user": args.user = argv[++i]; break;
      case "--key": args.key = argv[++i]; break;
      case "--ssh-port": args.sshPort = Number(argv[++i]); break;
      case "--ws-port": args.wsPort = Number(argv[++i]); break;
      case "--tunnel-port": args.tunnelPort = Number(argv[++i]); break;
      case "--image": args.image = argv[++i]; break;
      case "--container": args.container = argv[++i]; break;
      case "--token": args.token = argv[++i]; break;
      case "--blackboard": args.blackboard = argv[++i]; break;
      case "--timeout-ms": args.timeoutMs = Number(argv[++i]); break;
      case "--env": {
        const pair = argv[++i];
        const eqIndex = pair.indexOf("=");
        if (eqIndex <= 0 || eqIndex === pair.length - 1) {
          console.error(`Invalid --env format: ${pair} (expected KEY=VALUE)`);
          process.exit(1);
        }
        args.env[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
        break;
      }
      case "--expected-node": args.expectedNode = argv[++i]; break;
      case "--teardown": args.teardown = true; break;
      case "--help": args.help = true; break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }
  return args;
}

function validateNumber(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`Invalid ${name}: must be a positive number`);
    process.exit(1);
  }
  return value;
}

function buildConfig(args: ParsedArgs): RemoteWorkerConfig {
  return {
    host: args.host!,
    user: args.user!,
    keyPath: args.key,
    sshPort: validateNumber(args.sshPort, "ssh-port", DEFAULTS.sshPort),
    wsPort: validateNumber(args.wsPort, "ws-port", DEFAULTS.wsPort),
    tunnelPort: validateNumber(args.tunnelPort, "tunnel-port", DEFAULTS.tunnelPort),
    image: args.image ?? DEFAULTS.image,
    containerName: args.container ?? DEFAULTS.container,
    token: args.token,
    env: args.env,
  };
}

function getPidFilePath(blackboardPath: string): string {
  const blackboardDir = dirname(blackboardPath);
  return join(blackboardDir, "remote-tunnel.pid");
}

async function runLaunch(args: ParsedArgs): Promise<void> {
  // Validate required flags
  if (!args.host) {
    console.error("Missing required flag: --host");
    process.exit(1);
  }
  if (!args.user) {
    console.error("Missing required flag: --user");
    process.exit(1);
  }
  if (!args.blackboard) {
    console.error("Missing required flag: --blackboard");
    process.exit(1);
  }

  const config = buildConfig(args);
  const timeoutMs = validateNumber(args.timeoutMs, "timeout-ms", DEFAULTS.timeoutMs);
  const blackboardPath = args.blackboard;

  // Print provision command summary
  const provision = buildProvisionCommand(config);
  console.error(`[launch] Provisioning worker on ${config.user}@${config.host}:${config.sshPort}`);
  console.error(`[launch] Image: ${config.image}`);
  console.error(`[launch] Container: ${config.containerName}`);
  console.error(`[launch] Tunnel: ${config.tunnelPort} -> 127.0.0.1:${config.wsPort}`);
  console.error(`[launch] WS URL for container: ws://127.0.0.1:${config.tunnelPort}`);
  if (config.token) console.error(`[launch] Registration token: ${config.token}`);
  if (config.env && Object.keys(config.env).length > 0) {
    console.error(`[launch] Env vars: ${Object.keys(config.env).join(", ")}`);
  }

  // Run provision command (spawnSync - wait for completion)
  console.error(`[launch] Running provision command...`);
  const provisionResult = spawnSync("ssh", provision.argv.slice(1), {
    input: provision.stdin,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (provisionResult.status !== 0) {
    console.error(`[launch] Provision failed (exit code ${provisionResult.status})`);
    if (provisionResult.stderr) console.error(provisionResult.stderr.toString());
    if (provisionResult.stdout) console.error(provisionResult.stdout.toString());
    process.exit(1);
  }
  console.error(`[launch] Provision completed successfully`);

  // Spawn SSH reverse tunnel in background
  const tunnelCmd = buildTunnelCommand(config);
  console.error(`[launch] Starting SSH reverse tunnel: ${tunnelCmd.join(" ")}`);
  const tunnelChild = spawn("ssh", tunnelCmd.slice(1), {
    stdio: "ignore",
    detached: true,
  });
  tunnelChild.unref();

  // Write tunnel PID to file
  const pidFile = getPidFilePath(blackboardPath);
  const pid = tunnelChild.pid ?? 0;
  if (pid > 0) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(dirname(pidFile), { recursive: true });
    writeFileSync(pidFile, String(pid), "utf8");
    console.error(`[launch] Tunnel PID ${pid} written to ${pidFile}`);
  } else {
    console.error(`[launch] WARNING: Could not determine tunnel PID`);
  }

  // Determine expected nodeId for verification
  // The container chooses its own nodeId (GENTLE_COWORK_NODE_ID defaults to remote-<hostname>-<pid>)
  // For v1, we accept --expected-node; when omitted, skip verification with a note.
  const expectedNodeId = args.expectedNode ?? `remote-${config.host}-${pid}`;

  // Verify registration if --expected-node was provided
  if (args.expectedNode) {
    console.error(`[launch] Verifying worker registration (nodeId: ${expectedNodeId})...`);
    try {
      const board = openBlackboard(blackboardPath);
      await verifyRegistration(board, [expectedNodeId], { timeoutMs });
      console.error(`[launch] Worker registration verified: ${expectedNodeId}`);
    } catch (error) {
      console.error(`[launch] Registration verification failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  } else {
    console.error(`[launch] Skipping registration verification (no --expected-node provided)`);
    console.error(`[launch] Expected nodeId (container default): ${expectedNodeId}`);
  }

  // Final summary
  const envFilePath = `/etc/gentle-cowork/worker.env`;
  console.error(`
[launch] Remote worker launched successfully
  VPS host:       ${config.host}
  Container:      ${config.containerName}
  Tunnel port:    ${config.tunnelPort} (container connects to ws://127.0.0.1:${config.tunnelPort})
  WS URL:         ws://127.0.0.1:${config.tunnelPort}
  Env file (VPS): ${envFilePath}
  Tunnel PID:     ${pid}
  PID file:       ${pidFile}
`);
}

async function runTeardown(args: ParsedArgs): Promise<void> {
  // For teardown, --host, --user, --blackboard are required
  if (!args.host) {
    console.error("Missing required flag: --host");
    process.exit(1);
  }
  if (!args.user) {
    console.error("Missing required flag: --user");
    process.exit(1);
  }
  if (!args.blackboard) {
    console.error("Missing required flag: --blackboard");
    process.exit(1);
  }

  const config = buildConfig(args);
  const blackboardPath = args.blackboard;

  console.error(`[teardown] Tearing down worker on ${config.user}@${config.host}:${config.sshPort}`);
  console.error(`[teardown] Container: ${config.containerName}`);

  // Run teardown command
  const teardownCmd = buildTeardownCommand(config);
  console.error(`[teardown] Running: ${teardownCmd.join(" ")}`);
  const teardownResult = spawnSync("ssh", teardownCmd.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (teardownResult.status !== 0) {
    console.error(`[teardown] Teardown failed (exit code ${teardownResult.status})`);
    if (teardownResult.stderr) console.error(teardownResult.stderr.toString());
    if (teardownResult.stdout) console.error(teardownResult.stdout.toString());
    process.exit(1);
  }
  console.error(`[teardown] Container removed`);

  // Kill tunnel process from PID file
  const pidFile = getPidFilePath(blackboardPath);
  const { readFileSync, unlinkSync, existsSync } = await import("node:fs");

  if (existsSync(pidFile)) {
    try {
      const pidStr = readFileSync(pidFile, "utf8").trim();
      const pid = Number.parseInt(pidStr, 10);
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGTERM");
          console.error(`[teardown] Sent SIGTERM to tunnel PID ${pid}`);
        } catch {
          // Already dead is not an error
          console.error(`[teardown] Tunnel PID ${pid} already gone`);
        }
      }
      unlinkSync(pidFile);
      console.error(`[teardown] Removed PID file ${pidFile}`);
    } catch (error) {
      console.error(`[teardown] Warning: failed to clean up PID file: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.error(`[teardown] No PID file found at ${pidFile} (tunnel may not have been started)`);
  }

  console.error(`[teardown] Teardown complete`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (args.teardown) {
    await runTeardown(args);
  } else {
    await runLaunch(args);
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});