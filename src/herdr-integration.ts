/**
 * Herdr integration for gentle-cowork (PI-T3).
 *
 * Integrates the Herdr agent state reporter with the master/worker lifecycle.
 * Reports state transitions to Herdr via the socket transport.
 */

import { createHerdrReporter, type HerdrReporter, type HerdrAgentState } from "./herdr-state.ts";
import type { MasterOrchestrator } from "./orchestrator/master.ts";
import type { Blackboard } from "./blackboard.ts";
import type { TaskContract } from "./types.ts";

/** Herdr integration for the master orchestrator. */
export interface MasterHerdrIntegration {
	/** The Herdr reporter for the master. */
	reporter: ReturnType<typeof createHerdrReporter>;
	/** Starts reporting master state. */
	start(): void;
	/** Stops reporting. */
	stop(): void;
}

/** Herdr integration for a worker. */
export interface WorkerHerdrIntegration {
	reporter: ReturnType<typeof createHerdrReporter>;
	start(): void;
	stop(): void;
}

/** Creates a Herdr integration for the master orchestrator. */
export function createMasterHerdrIntegration(
	master: MasterOrchestrator,
	options: {
		agentId?: string;
		board: any; // Blackboard type
	} = { board: undefined as any },
): MasterHerdrIntegration {
	const agentId = options.agentId ?? `master-${process.pid}-${Date.now()}`;
	
	// Create the Herdr reporter for the master
	const reporter = createHerdrReporter({
		agentId,
		role: "master",
	});

	let isRunning = false;
	let lastState: "working" | "blocked" | "idle" | "crashed" = "idle";

	// Report state change
	const report = async (state: "working" | "blocked" | "idle" | "crashed", message?: string) => {
		await reporter.report(state, message);
	};

	// Start reporting master state
	const start = (): void => {
		if (isRunning) return;
		// Initial state report
		report("working", "Master orchestrator started").catch(() => {});
		// Periodic heartbeat
		const interval = setInterval(() => {
			report(lastState, "Master heartbeat").catch(() => {});
		}, 30_000); // Every 30 seconds
		// Store interval ID for cleanup
		(globalThis as any).__herdrMasterInterval = interval;
		isRunning = true;
	};

	// Stop reporting
	const stop = (): void => {
		if (!isRunning) return;
		report("idle", "Master orchestrator stopped").catch(() => {});
		// Clear the interval
		const interval = (globalThis as any).__herdrMasterInterval;
		if (interval) clearInterval(interval);
		isRunning = false;
	};

	return {
		reporter,
		start,
		stop,
	};
}

/** Creates a Herdr integration for a worker. */
export function createWorkerHerdrIntegration(
	options: {
		agentId: string;
		board?: any; // Blackboard type
	},
): {
	reporter: ReturnType<typeof createHerdrReporter>;
	start: () => void;
	stop: () => void;
} {
	const reporter = createHerdrReporter({
		agentId: options.agentId,
		role: "worker",
	});

	let isRunning = false;
	let lastState: "working" | "blocked" | "idle" | "crashed" = "idle";

	const report = async (state: "working" | "blocked" | "idle" | "crashed", message?: string) => {
		await reporter.report(state, message);
	};

	const start = (): void => {
		if (isRunning) return;
		report("working", "Worker started").catch(() => {});
		const interval = setInterval(() => {
			report("working", "Worker heartbeat").catch(() => {});
		}, 30_000);
		(globalThis as any).__herdrWorkerInterval = interval;
		isRunning = true;
	};

	const stop = (): void => {
		if (!isRunning) return;
		report("idle", "Worker stopped").catch(() => {});
		const interval = (globalThis as any).__herdrWorkerInterval;
		if (interval) clearInterval(interval);
		isRunning = false;
	};

	return {
		reporter,
		start,
		stop,
	};
}