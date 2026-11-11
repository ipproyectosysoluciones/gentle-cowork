/**
 * Herdr agent state export for gentle-cowork (PI-T3).
 *
 * Reports master/worker lifecycle to Herdr via the same socket transport
 * pattern used by gentle-shell's Herdr agent bridge (gentle-herdr-agent.ts):
 * JSON requests over the HERDR_SOCKET_PATH Unix socket / named pipe, with a
 * two-attempt retry budget. Failures never block the caller — when Herdr is
 * absent (no socket path) every report is a no-op.
 *
 * Herdr's custom-agent contract: a stable `source` (never `herdr:`), an
 * `agent` label, a `pane_id`, and a monotonically increasing `seq`.
 */

import net from "node:net";
import { posix, win32 } from "node:path";

/** The stable source identifier for this extension's reports. */
const SOURCE = "gentle-cowork";

export type HerdrAgentState = "working" | "blocked" | "idle" | "crashed";

interface HerdrRequest {
	id: string;
	method: string;
	params: Record<string, unknown>;
}

/** Same socket framing and retry budget as gentle-shell's Herdr bridge. */
function socketTransport(
	socketPath: string,
): (request: HerdrRequest) => Promise<void> {
	const endpoint =
		process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
	const attempt = (request: HerdrRequest, timeoutMs: number) =>
		new Promise<boolean>((resolve) => {
			let done = false;
			const socket = net.createConnection(endpoint);
			const finish = (delivered: boolean) => {
				if (done) return;
				done = true;
				clearTimeout(timeout);
				socket.destroy();
				resolve(delivered);
			};
			socket.on("error", () => finish(false));
			socket.on("connect", () =>
				socket.write(`${JSON.stringify(request)}\n`),
			);
			socket.on("data", () => finish(true));
			socket.on("end", () => finish(false));
			const timeout = setTimeout(() => finish(false), timeoutMs);
			timeout.unref?.();
		});
	return async (request) => {
		if (!(await attempt(request, 500))) await attempt(request, 1500);
	};
}

export interface HerdrReporterOptions {
	/** Stable agent identifier within this source (e.g. the nodeId). */
	agentId: string;
	/** Which gentle-cowork role is reporting: master or worker. */
	role: "master" | "worker";
	/** Process env override (defaults to process.env). */
	env?: NodeJS.ProcessEnv;
	/** Injectable transport for tests; defaults to the Herdr socket transport. */
	send?: (request: HerdrRequest) => Promise<void>;
}

export interface HerdrReporter {
	/** Reports one state transition (no-op when unchanged unless force). */
	report: (state: HerdrAgentState, message?: string) => Promise<void>;
	/** The label Herdr displays for this agent. */
	getAgentLabel: () => string;
}

/**
 * Creates a Herdr state reporter for one gentle-cowork node (master/worker).
 * Without HERDR_SOCKET_PATH the transport is a no-op and reports resolve
 * immediately — the orchestration never depends on Herdr being present.
 */
export function createHerdrReporter(
	options: HerdrReporterOptions,
): HerdrReporter {
	const env = options.env ?? process.env;
	const agentLabel = `gc-${options.role}-${options.agentId}`;
	const paneId = env.HERDR_PANE_ID ?? `gc-${options.role}-${options.agentId}`;

	// Prefer the session file, as gentle-shell's bridge does; fall back to the id.
	const sessionRef: Record<string, string> = {};
	const sessionFile = env.PI_SESSION_FILE;
	if (typeof sessionFile === "string" && (posix.isAbsolute(sessionFile) || win32.isAbsolute(sessionFile))) {
		sessionRef.agent_session_path = sessionFile;
	}

	const send = options.send ?? (env.HERDR_SOCKET_PATH
		? socketTransport(env.HERDR_SOCKET_PATH)
		: async () => {});

	let seq = 0;
	let last: { state: string; message?: string } | undefined;

	const report = async (
		state: HerdrAgentState,
		message?: string,
	): Promise<void> => {
		if (
			last &&
			last.state === state &&
			last.message === message
		) {
			return; // unchanged — Herdr only needs transitions
		}
		last = { state, message };
		seq += 1;
		const request: HerdrRequest = {
			id: `${SOURCE}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
			method: "pane.report_agent",
			params: {
				pane_id: paneId,
				source: SOURCE,
				agent: agentLabel,
				state,
				message,
				seq,
				...sessionRef,
			},
		};
		try {
			await send(request);
		} catch {
			// Herdr availability must never break orchestration.
		}
	};

	return {
		report,
		getAgentLabel: () => agentLabel,
	};
}
