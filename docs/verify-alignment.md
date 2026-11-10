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

## Fundamental Differences

| Aspect | gentle-cowork Verifier | Native Review Integration |
|--------|------------------------|---------------------------|
| Purpose | ODD spec verification (S1, S2) | Code review with lenses |
| Output | Custom `VerifyVerdict` (APPROVE/CHANGES) | `review-result-artifact/v2` with lenses |
| Lenses | N/A (S1, S2 requirements) | review-risk, review-resilience, review-readability, review-reliability |
| Transport | Custom `SubagentRpc` + `runSubagentTurn` | Native `review.start`, `review.status`, `review.finalize` |
| Roles | Custom `cowork-verifier` subagent | Native refuter/validator via provider role capture |
| Transport | Custom `SubagentRpc` + `pi --mode rpc` | Native `review.start`, `review.status`, `review.finalize` |

## Alignment Assessment

**Fundamental Mismatch**: The current implementation is purpose-built for **ODD spec verification** (S1, S2 requirements about type exports), while the native review integration is designed for **code review with lenses** (review-risk, review-resilience, etc.).

**Key Differences**:
1. **Purpose**: ODD spec verification vs. code review with lenses
2. **Output Format**: Custom `VerifyVerdict` vs `review-result-artifact/v2` with lenses
3. **Transport**: Custom `SubagentRpc` vs native `review.start`/`review.status`/`review.finalize`
4. **Roles**: Custom `cowork-verifier` vs native refuter/validator via provider role capture
5. **Lenses**: S1/S2 requirements vs review-risk/review-resilience/review-readability/review-reliability

## Alignment Decision

**Current Decision**: Keep current implementation working. The use cases are fundamentally different:
- gentle-cowork verifier: ODD spec verification (S1, S2)
- Native review integration: Code review with lenses

**Future Alignment Consideration**: If the use cases converge (e.g., if ODD spec verification needs to produce review artifacts), consider:
1. Mapping `VerifyVerdict` to `review-result-artifact/v2` format
2. Using native `review.start`/`review.finalize` operations
2. Mapping S1/S2 requirements to appropriate lenses

## TODO for Future Alignment

- [ ] Evaluate if ODD spec verification can map to review lenses
- [ ] Investigate if `review.start`/`review.finalize` can replace custom subagent flow
- [ ] Map `VerifyRequirement` (S1, S2) to appropriate lenses
- [ ] Evaluate if native `review.start`/`review.finalize` can replace custom `runVerifier`
- [ ] Consider implementing `review-verification-evidence/v2` for evidence tracking

## Current Status

✅ **Current Implementation**: Working, tested (304 tests passing), TypeScript clean
- `runVerifier` with custom `SubagentRpc` and `runSubagentTurn`
- Custom `VerifyVerdict` parsing with `APPROVE`/`CHANGES` outcome
- Tests passing (304 passed | 3 todo)

## Recommendation

**Keep current implementation working**. The use cases are fundamentally different:
- gentle-cowork: ODD spec verification (S1, S2)
- Native review: Code review with lenses

**Future**: Re-evaluate if ODD spec verification needs to produce review artifacts or if native review integration can be extended for spec verification.
