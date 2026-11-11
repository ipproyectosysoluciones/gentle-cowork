/**
 * Metering (Phase 6.3): model usage per contract, accumulated for the oracle.
 *
 * The ledger is a pure accumulator — `recordUsageSample` returns a new ledger
 * and never mutates its input — so the blackboard can persist the result in one
 * atomic write. Aggregates are totals, not an event log: the file must stay
 * bounded no matter how long a contract runs.
 *
 * `tokens` is `number | null` because the RPC boundary does not expose token
 * usage yet (decision L2.1 in odd/tasks/phase6-oracle.md); a single unknown
 * sample makes the aggregated total unknown rather than pretending zero spend.
 */

export interface UsageSample {
	/** Model calls represented by this sample. */
	modelCalls: number;
	/** Tokens consumed, or null when this boundary cannot know. */
	tokens: number | null;
	/** Wall time consumed, in milliseconds. */
	wallTimeMs: number;
}

/** Usage accumulated for one node inside one contract. */
export interface NodeUsage {
	modelCalls: number;
	tokens: number | null;
	wallTimeMs: number;
	events: number;
}

/** Usage accumulated for one contract, split by the node that spent it. */
export interface ContractUsage extends NodeUsage {
	byNode: Record<string, NodeUsage>;
}

/** The full usage ledger, keyed by contract id. */
export interface UsageLedger {
	contracts: Record<string, ContractUsage>;
}

/** An empty ledger: no contracts, no usage. */
export function emptyUsageLedger(): UsageLedger {
	return { contracts: {} };
}

/** Sums token totals where every operand is known; any unknown makes it unknown. */
const addTokens = (a: number | null, b: number | null): number | null =>
	a === null || b === null ? null : a + b;

const addSample = (usage: NodeUsage, sample: UsageSample): NodeUsage => ({
	modelCalls: usage.modelCalls + sample.modelCalls,
	tokens: addTokens(usage.tokens, sample.tokens),
	wallTimeMs: usage.wallTimeMs + sample.wallTimeMs,
	events: usage.events + 1,
});

const emptyNodeUsage = (): NodeUsage => ({ modelCalls: 0, tokens: 0, wallTimeMs: 0, events: 0 });

/**
 * Records one sample and returns a new ledger. The input is never mutated, so
 * a failed persistence can simply discard the result.
 */
export function recordUsageSample(
	ledger: UsageLedger,
	entry: { contractId: string; nodeId: string; sample: UsageSample },
): UsageLedger {
	const contract = ledger.contracts[entry.contractId] ?? {
		...emptyNodeUsage(),
		byNode: {},
	};
	const node = contract.byNode[entry.nodeId] ?? emptyNodeUsage();
	return {
		contracts: {
			...ledger.contracts,
			[entry.contractId]: {
				...addSample(contract, entry.sample),
				byNode: {
					...contract.byNode,
					[entry.nodeId]: addSample(node, entry.sample),
				},
			},
		},
	};
}
