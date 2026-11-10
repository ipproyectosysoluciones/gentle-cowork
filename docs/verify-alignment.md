# Verify Alignment with gentle-shell Native Review Integration

## Current Implementation (gentle-cowork)

**Purpose**: ODD spec verification (S1, S2 requirements)
- Verifies that `src/types.ts` exports `TaskContract` with `specRef: string`
- Verifies that `src/types.ts` exports `CoworkRole` with exactly 'planner', 'implementer', 'verifier'
- Uses custom `runVerifier` that spawns a subagent via `pi --mode rpc`
- Parses verdict as custom `VerifyVerdict` (APPROVE/CHANGES with requirements)
- Uses custom `runSubagentTurn` with `SubagentRpc`

## Native gentle-shell Review Integration (gentle-pi 4.7+)

**Purpose**: Code review with lenses
- Lenses: `review-risk`, `review-resilience`, `review-readability`, `review-reliability`
- Operations: `review.start`, `review.status`, `review.finalize`, `review.validate`, `review.repair`
- Result artifacts: `gentle-ai.review-result-artifact/v2` with lenses
- Native refuter/validator roles via provider role capture

## ODD S1/S2 Mapping to Native Lenses

| ODD Requirement | Description | Native Lens Mapping | Rationale |
|-----------------|-------------|---------------------|-----------|
| **S1** | `TaskContract` exports `specRef: string` | `review-readability` + `review-reliability` | Type export verification ensures code readability and type reliability |
| **S2** | `CoworkRole` exports exactly 'planner', 'implementer', 'verifier' | `review-reliability` + `review-readability` | Enum completeness and type safety ensure reliability and readability |

## ODD S1/S2 → Native Lens Mapping

| ODD Requirement | Native Lens | Verification Criteria |
|-----------------|-------------|----------------------|
| **S1**: `TaskContract.specRef: string` | `review-readability` (primary) + `review-reliability` (secondary) | Field exists, correct type, documented |
| **S2** `CoworkRole` enum values | `review-reliability` (primary) + `review-readability` (secondary) | Enum has exactly 3 values, no more no less |

## Proposed Native Review Flow

```typescript
// New native verify flow using review.start/finalize
async function runNativeVerify(request: NativeVerifyRequest): Promise<ReviewResult> {
  // 1. Start review with appropriate lenses
  const review = await review.start({
    targetIdentity: "gentle-cowork-types",
    lenses: ["review-readability", "review-reliability"],
    artifactSubject: {
      schema: "gentle-ai.review-artifact-subject/v2",
      subjectHash: <hash-of-src-types-ts>,
      lineageId: "verify-phase1",
      authorityRevision: <current-commit>,
      targetIdentity: <workspace-hash>,
      baseTree: <base-commit>,
      candidateTree: <head-commit>,
      changedPathManifestSha256: <hash>,
      lens: "review-readability", // primary for S1
      selectedOrder: 0,
      correctionTargetIdentity: <target>
    }
  });

  // 2. Execute verification (read-only analysis of src/types.ts)
  const evidence = await runTypeVerification(); // S1 + S2 checks

  // 3. Finalize with evidence
  const result = await review.finalize({
    lineageId: review.lineageId,
    revision: <current-revision>,
    targetIdentity: <target>,
    resultArtifacts: [{
      schema: "gentle-ai.review-result-artifact/v2",
      capability: "review.native_result_artifact",
      path: <evidence-path>,
      sha256: <evidence-hash>,
      lineageId: "verify-phase1",
      targetIdentity: <target>,
      lens: "review-readability",
      selectedOrder: 0
    }]
  });

  return result;
}
```

## ODD S1/S2 → Native Lens Mapping Summary

| ODD Spec | Requirement | Native Lens | Verification Artifact |
|------------|-------------|-------------|----------------------|
| **S1** | `TaskContract.specRef: string` | `review-readability` (primary) | Type existence + type correctness |
| | | `review-reliability` (secondary) | Type safety, no `any` |
| **S2** | `CoworkRole` enum = exactly 3 values | `review-reliability` (primary) | Enum completeness + exhaustiveness |
| | | `review-readability` (secondary) | Clear naming, documentation |

## Implementation Plan

### Phase 1: Mapping Complete ✅
- [x] Document ODD S1/S2 → native lens mapping

### Phase 2: Refactor `src/verifier.ts`
- [ ] Replace `runVerifier` with native `review.start`/`review.finalize`
- [ ] Map `VerifyVerdict` → `review-result-artifact/v2`
- [ ] Use native lenses: `review-readability`, `review-reliability`
- [ ] Remove custom `runSubagentTurn` + `SubagentRpc` dependency

### Phase 3: Tests
- [ ] Update tests to use native review flow
- [ ] Verify 304 tests pass + typecheck clean

### Phase 4: Live Testing
- [ ] Test `/cowork-verify` with native review flow

---

## References

- Native Review Integration: `gentle-pi` contracts `review-integration/v2`
- Result Artifact: `gentle-ai.review-result-artifact/v2`
- Lenses: `review-risk`, `review-resilience`, `review-readability`, `review-reliability`
- Operations: `review.start`, `review.status`, `review.finalize`, `review.validate`, `review.repair`
- Artifact Subject: `gentle-ai.review-artifact-subject/v2`
- Result Artifact: `gentle-ai.review-result-artifact/v2`
