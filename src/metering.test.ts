/**
 * Metering (Phase 6.3): capture of model usage per contract on the blackboard.
 *
 * The ledger is a pure accumulator: recording returns a new ledger and never
 * mutates the input, so callers can persist the result atomically. Tokens are
 * `number | null` because the RPC boundary does not expose token usage today;
 * a single unknown sample makes the aggregated total unknown, never a lie.
 */
import { describe, expect, it } from "vitest";
import { emptyUsageLedger, recordUsageSample, type UsageSample } from "./metering.ts";

const sample = (over: Partial<UsageSample> = {}): UsageSample => ({
  modelCalls: 1,
  tokens: null,
  wallTimeMs: 100,
  ...over,
});

describe("usage ledger — pure accumulation (6.3)", () => {
  it("starts empty: zero totals, no contracts", () => {
    const ledger = emptyUsageLedger();
    expect(ledger.contracts).toEqual({});
  });

  it("records one sample per contract and per node", () => {
    let ledger = emptyUsageLedger();
    ledger = recordUsageSample(ledger, {
      contractId: "t1",
      nodeId: "worker-a",
      sample: sample({ wallTimeMs: 1200 }),
    });

    const contract = ledger.contracts["t1"];
    expect(contract).toBeDefined();
    expect(contract?.modelCalls).toBe(1);
    expect(contract?.wallTimeMs).toBe(1200);
    expect(contract?.events).toBe(1);
    expect(contract?.tokens).toBeNull();
    expect(contract?.byNode["worker-a"]?.wallTimeMs).toBe(1200);
  });

  it("aggregates across samples, splitting totals by node", () => {
    let ledger = emptyUsageLedger();
    ledger = recordUsageSample(ledger, { contractId: "t1", nodeId: "worker-a", sample: sample() });
    ledger = recordUsageSample(ledger, {
      contractId: "t1",
      nodeId: "worker-b",
      sample: sample({ wallTimeMs: 300 }),
    });

    const contract = ledger.contracts["t1"];
    expect(contract?.events).toBe(2);
    expect(contract?.modelCalls).toBe(2);
    expect(contract?.wallTimeMs).toBe(400);
    expect(contract?.byNode["worker-a"]?.events).toBe(1);
    expect(contract?.byNode["worker-b"]?.wallTimeMs).toBe(300);
  });

  it("sums tokens only when every sample knows them; one unknown makes the total unknown", () => {
    let ledger = emptyUsageLedger();
    ledger = recordUsageSample(ledger, {
      contractId: "t1",
      nodeId: "worker-a",
      sample: sample({ tokens: 500 }),
    });
    ledger = recordUsageSample(ledger, {
      contractId: "t1",
      nodeId: "worker-a",
      sample: sample({ tokens: 250 }),
    });
    expect(ledger.contracts["t1"]?.tokens).toBe(750);

    ledger = recordUsageSample(ledger, {
      contractId: "t1",
      nodeId: "worker-b",
      sample: sample({ tokens: null }),
    });
    expect(ledger.contracts["t1"]?.tokens).toBeNull();
  });

  it("never mutates the ledger it was given", () => {
    const before = emptyUsageLedger();
    const after = recordUsageSample(before, {
      contractId: "t1",
      nodeId: "worker-a",
      sample: sample(),
    });
    expect(before.contracts).toEqual({});
    expect(after.contracts["t1"]).toBeDefined();
  });
});
