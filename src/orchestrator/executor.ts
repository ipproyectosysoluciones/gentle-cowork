/**
 * T5.8 — RPC step executor: the real worker transport.
 *
 * One assigned contract = one fresh `pi --mode rpc` child (the proven
 * cowork-verifier pattern): spawn inherits the session's own pi CLI and
 * model configuration (no override unless explicitly passed), the BLA-26
 * readiness handshake guards the first prompt, and the role-child marker
 * (GENTLE_COWORK_ROLE=1) plus `--exclude-tools subagent_*` keep role children
 * from spawning sub-subagents. Unit tests never spawn this executor — they
 * use mock executors (L15 amendment 4).
 */

import { createRpcSubagent, runSubagentTurn } from "../subagent.ts";
import { buildImplementPrompt, parseArtifact } from "../roles.ts";
import type { StepExecutor, WorkerStepVerdict } from "./types.ts";
import type { TaskContract } from "../types.ts";

/** Options for the RPC step executor. */
export interface RpcExecutorOptions {
  /** Working directory for the worker child process. */
  cwd?: string;
  /** Provider override; defaults to the child's own (session) configuration. */
  provider?: string;
  /** Model override; defaults to the child's own (session) configuration. */
  model?: string;
  /** Explicit CLI entry path; defaults to the running pi's own cli.js. */
  cliPath?: string;
  /** Overall timeout for one contract execution, in ms. */
  timeoutMs?: number;
}

/** Failed verdict with the given reason. */
function failedVerdict(contract: TaskContract, workerNodeId: string, error: string): WorkerStepVerdict {
  return {
    contractId: contract.id,
    workerNodeId,
    status: "failed",
    criteria: [],
    artifacts: [],
    executedAt: new Date().toISOString(),
    error,
  };
}

/**
 * Creates a step executor that runs each assigned contract in a fresh
 * `pi --mode rpc` subprocess and maps the implementer artifact response to a
 * worker verdict. Per-criterion satisfaction is the implementer's self-report;
 * the master's verifier (co-located) holds the authoritative check.
 */
export function createRpcStepExecutor(options: RpcExecutorOptions = {}): StepExecutor {
  const workerNodeId = `rpc-worker-${process.pid}`;
  return {
    async execute(contract: TaskContract): Promise<WorkerStepVerdict> {
      const rpc = createRpcSubagent({
        cwd: options.cwd,
        provider: options.provider,
        model: options.model,
        cliPath: options.cliPath,
      });
      const prompt = buildImplementPrompt(
        {
          step: 1,
          objective: contract.objective,
          scope: contract.scope,
          acceptanceCriteria: contract.acceptanceCriteria,
        },
        contract.specRef,
      );
      const raw = await runSubagentTurn(prompt, rpc, options.timeoutMs);
      if (!raw) {
        return failedVerdict(contract, workerNodeId, "the worker subprocess returned no assistant text");
      }
      try {
        const artifact = parseArtifact(raw);
        const evidence = artifact.changesSummary + (artifact.notes ? ` — ${artifact.notes}` : "");
        const satisfied = artifact.stepsCompleted.length > 0;
        return {
          contractId: contract.id,
          workerNodeId,
          status: "completed",
          criteria: contract.acceptanceCriteria.map((criterion) => ({
            criterion,
            satisfied,
            evidence,
          })),
          artifacts: [...artifact.filesModified],
          executedAt: new Date().toISOString(),
        };
      } catch (error) {
        return failedVerdict(
          contract,
          workerNodeId,
          `implementer response could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
