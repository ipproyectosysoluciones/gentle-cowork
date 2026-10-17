---
name: Bug report
about: Report reproducible misbehavior with evidence
title: "<what broke, where — clear, specific, searchable>"
labels: ["bug"]
---

Evidence is required. "It doesn't work" is not a report — reproduction is.

## Bug

<!-- What happened, in one sentence. -->

## Expected

<!-- What should have happened instead. -->

## Reproduce

<!-- Minimal numbered steps, including the exact commands run. -->

1.
2.
3.

## Evidence

<!-- Paste the failing command output (npx vitest run / npx tsc --noEmit / runtime logs). Redact secrets before pasting. -->

```
<paste output>
```

## Environment

- OS:
- Node version: <!-- node --version -->
- Pi / gentle-shell version: <!-- the extension host you run gentle-cowork on -->
- gentle-cowork version / commit:
- Relevant configuration:

## Suspected contract violation

<!-- Optional: which binding contract does this look like? -->

- [ ] Delegated by size instead of a named reason
- [ ] A subagent spawned a sub-subagent (flat-tree violation)
- [ ] A spec was paraphrased instead of passed by reference
- [ ] An SDD artifact appeared (should be TaskContract only)
- [ ] The verifier replaced the review authority instead of invoking it
- [ ] None — not contract-related
