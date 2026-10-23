/**
 * T5.9 — WS transport bridge hooks (tests).
 *
 * The server stays a pure transport: it never touches the blackboard. It
 * exposes injectable callbacks (registration, step results, heartbeats) and
 * a sendTo push, so the master-side bridge can mirror remote worker state
 * onto the blackboard and push assignments. State still rides the blackboard
 * only (L15 amendment 2); WS carries notifications for nodes that cannot
 * read the file (remote stage, L19).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { WSServer } from "./server.ts";
import { WS_BIND, type AssignStep, type StepResult } from "./protocol.ts";

function connect(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const timeout = setTimeout(() => reject(new Error("connect timeout")), 2000);
		ws.once("open", () => {
			clearTimeout(timeout);
			resolve(ws);
		});
		ws.once("error", (e) => {
			clearTimeout(timeout);
			reject(e);
		});
	});
}

function waitMessage<T>(ws: WebSocket, type: string, timeoutMs = 2000): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`timeout waiting ${type}`)), timeoutMs);
		ws.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === type) {
				clearTimeout(timeout);
				resolve(msg as T);
			}
		});
		ws.once("error", reject);
	});
}

function registerAs(ws: WebSocket, nodeId: string): Promise<void> {
	ws.send(
		JSON.stringify({
			type: "register_worker",
			nodeId,
			role: "worker",
			capabilities: ["implementer"],
			startedAt: new Date().toISOString(),
		}),
	);
	return waitMessage(ws, "welcome").then(() => undefined);
}

const registered: Array<{ nodeId: string; capabilities: string[] }> = [];
const results: Array<{ msg: StepResult; sender: string }> = [];
const beats: string[] = [];

let server: WSServer;
let wsUrl = "";

beforeAll(async () => {
	server = new WSServer(0, WS_BIND, {
		onWorkerRegistered: (reg) => registered.push({ nodeId: reg.nodeId, capabilities: reg.capabilities }),
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

describe("T5.9 WS transport bridge hooks", () => {
	it("notifies registration and pushes assignments via sendTo", async () => {
		const ws = await connect(wsUrl);
		await registerAs(ws, "remote-worker-1");

		expect(registered).toHaveLength(1);
		expect(registered[0]).toEqual({ nodeId: "remote-worker-1", capabilities: ["implementer"] });

		const assign: AssignStep = {
			type: "assign_step",
			contractId: "gc-1",
			step: {
				id: "s1",
				objective: "implement the widget",
				scope: ["src/widget/"],
				acceptanceCriteria: ["widget tests pass"],
				specRef: "odd/tasks/gentle-cowork-phase5.md",
			},
			workerNodeId: "remote-worker-1",
		};
		expect(server.sendTo("remote-worker-1", assign)).toBe(true);
		const got = await waitMessage<AssignStep>(ws, "assign_step");
		expect(got.contractId).toBe("gc-1");
		expect(got.step.specRef).toBe("odd/tasks/gentle-cowork-phase5.md");
		expect(server.sendTo("unknown-node", assign)).toBe(false);
		ws.close();
	});

	it("delivers step results and heartbeats to the bridge callbacks", async () => {
		const ws = await connect(wsUrl);
		await registerAs(ws, "remote-worker-2");

		const result: StepResult = {
			type: "step_result",
			contractId: "gc-1",
			stepId: "s1",
			artifact: "src/widget/a.ts",
			status: "completed",
			workerVerdict: {
				contractId: "gc-1",
				workerNodeId: "remote-worker-2",
				status: "completed",
				criteria: [{ criterion: "widget tests pass", satisfied: true, evidence: "vitest 14/14 green" }],
				artifacts: ["src/widget/a.ts"],
				executedAt: new Date().toISOString(),
			},
		};
		ws.send(JSON.stringify(result));
		await new Promise((r) => setTimeout(r, 50));
		ws.send(JSON.stringify({ type: "heartbeat", nodeId: "remote-worker-2", timestamp: new Date().toISOString() }));
		await new Promise((r) => setTimeout(r, 50));

		expect(results).toHaveLength(1);
		expect(results[0].sender).toBe("remote-worker-2");
		expect(results[0].msg.workerVerdict?.criteria[0]?.criterion).toBe("widget tests pass");
		expect(beats).toContain("remote-worker-2");
		ws.close();
	});
});
