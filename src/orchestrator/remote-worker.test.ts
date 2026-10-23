/**
 * T5.9 — RemoteWorkerClient (tests).
 *
 * The remote worker is a WS client for nodes that cannot read the master's
 * blackboard file (Docker container on a VPS, per L19). It registers as an
 * implementer, receives assign_step pushes, executes via the injectable
 * StepExecutor (mock in tests, RPC in production — L15 amendment 4), and
 * reports step_result with the full structured verdict. The master applies
 * it to the blackboard as proxy-writer; the client never writes state.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { WSServer } from "../ws/server.ts";
import { WS_BIND, type StepResult, type WorkerVerdictPayload } from "../ws/protocol.ts";
import { RemoteWorkerClient } from "./remote-worker.ts";
import type { StepExecutor, WorkerStepVerdict } from "./types.ts";
import type { TaskContract } from "../types.ts";

/** Waits until `predicate` holds, polling every `pollMs` (bounded by timeoutMs). */
async function until(predicate: () => boolean, timeoutMs = 2000, pollMs = 25): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("condition not met within timeout");
		await new Promise((r) => setTimeout(r, pollMs));
	}
}

const registrations: string[] = [];
const results: Array<{ msg: StepResult; sender: string }> = [];
const beats: string[] = [];

let server: WSServer;
let wsUrl = "";

beforeAll(async () => {
	server = new WSServer(0, WS_BIND, {
		onWorkerRegistered: (reg) => registrations.push(reg.nodeId),
		onStepResult: (msg, senderNodeId) => results.push({ msg, sender: senderNodeId }),
		onHeartbeat: (nodeId) => beats.push(nodeId),
	});
	await server.start();
	const addr = server.httpServer.address() as { port: number };
	wsUrl = `ws://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
	await server.stop();
});

const ASSIGN = {
	type: "assign_step" as const,
	contractId: "gc-7",
	step: {
		id: "s1",
		objective: "implement the remote slice",
		scope: ["src/orchestrator/"],
		acceptanceCriteria: ["suite green", "typecheck clean"],
		specRef: "odd/tasks/gentle-cowork-phase5.md",
	},
	workerNodeId: "remote-worker-1",
};

function makeExecutor(verdict?: Partial<WorkerStepVerdict>): { execute: ReturnType<typeof vi.fn>; executor: StepExecutor } {
	const execute = vi.fn(async (contract: TaskContract): Promise<WorkerStepVerdict> => ({
		contractId: contract.id,
		workerNodeId: "remote-worker-1",
		status: "completed",
		criteria: contract.acceptanceCriteria.map((criterion) => ({
			criterion,
			satisfied: true,
			evidence: "mock evidence",
		})),
		artifacts: ["src/orchestrator/remote-worker.ts"],
		executedAt: new Date().toISOString(),
		...verdict,
	}));
	return { execute, executor: { execute } };
}

describe("T5.9 RemoteWorkerClient", () => {
	it("registers as implementer and reports start readiness", async () => {
		const client = new RemoteWorkerClient({
			url: wsUrl,
			nodeId: "remote-worker-1",
			executor: makeExecutor().executor,
			heartbeatMs: 20,
		});
		await client.start();
		await until(() => registrations.includes("remote-worker-1"));
		expect(registrations).toContain("remote-worker-1");
		await client.stop();
	});

	it("executes an assigned contract and reports the structured verdict", async () => {
		const { execute, executor } = makeExecutor();
		const client = new RemoteWorkerClient({
			url: wsUrl,
			nodeId: "remote-worker-2",
			executor,
			heartbeatMs: 20,
		});
		await client.start();

		expect(server.sendTo("remote-worker-2", ASSIGN)).toBe(true);

		await until(() => execute.mock.calls.length > 0);
		const executed = execute.mock.calls[0][0] as TaskContract;
		expect(executed.id).toBe("gc-7");
		expect(executed.objective).toBe("implement the remote slice");
		expect(executed.specRef).toBe("odd/tasks/gentle-cowork-phase5.md");
		expect(executed.acceptanceCriteria).toEqual(["suite green", "typecheck clean"]);
		expect(executed.workerNodeId).toBe("remote-worker-2");

		await until(() => results.some((r) => r.sender === "remote-worker-2"));
		const reported = results.find((r) => r.sender === "remote-worker-2")!;
		expect(reported.msg.type).toBe("step_result");
		expect(reported.msg.contractId).toBe("gc-7");
		const verdict = reported.msg.workerVerdict as WorkerVerdictPayload;
		expect(verdict.status).toBe("completed");
		expect(verdict.workerNodeId).toBe("remote-worker-2");
		expect(verdict.criteria).toHaveLength(2);
		expect(verdict.criteria[0]).toEqual({ criterion: "suite green", satisfied: true, evidence: "mock evidence" });
		await client.stop();
	});

	it("sends heartbeats while connected", async () => {
		const client = new RemoteWorkerClient({
			url: wsUrl,
			nodeId: "remote-worker-3",
			executor: makeExecutor().executor,
			heartbeatMs: 20,
		});
		await client.start();
		await until(() => beats.filter((b) => b === "remote-worker-3").length >= 2, 2000);
		await client.stop();
	});

	it("reconnects and re-registers after a server-side disconnect", async () => {
		const client = new RemoteWorkerClient({
			url: wsUrl,
			nodeId: "remote-worker-4",
			executor: makeExecutor().executor,
			heartbeatMs: 20,
			reconnectDelayMs: 25,
		});
		await client.start();
		await until(() => registrations.includes("remote-worker-4"));

		const conn = server.getWorkers().find((w) => w.nodeId === "remote-worker-4");
		expect(conn).toBeDefined();
		conn!.ws.close(1001, "kicked");

		await until(
			() => registrations.filter((id) => id === "remote-worker-4").length >= 2,
			3000,
		);
		await client.stop();
	});

	it("reports a failed verdict when the executor throws", async () => {
		const execute = vi.fn(async (_contract: TaskContract): Promise<WorkerStepVerdict> => {
			throw new Error("provider down");
		});
		const client = new RemoteWorkerClient({
			url: wsUrl,
			nodeId: "remote-worker-5",
			executor: { execute },
			heartbeatMs: 20,
		});
		await client.start();
		expect(server.sendTo("remote-worker-5", { ...ASSIGN, workerNodeId: "remote-worker-5" })).toBe(true);

		await until(() => results.some((r) => r.sender === "remote-worker-5"));
		const reported = results.find((r) => r.sender === "remote-worker-5")!;
		expect(reported.msg.status).toBe("failed");
		expect(reported.msg.workerVerdict?.status).toBe("failed");
		expect(reported.msg.workerVerdict?.error).toContain("provider down");
		await client.stop();
	});
});
