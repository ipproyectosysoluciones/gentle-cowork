<!--
  PR contract: read .github/CONTRIBUTING.md before opening.
  Target dev. One work unit per PR (~400 authored lines max) —
  bigger changes are split into chained PRs.
-->

## Work-unit summary

<!-- What this PR delivers, as one reviewable work unit. One or two sentences. -->

## Commits

<!-- Conventional-commit titles in this PR, in order. -->

-

## Linear issue

<!-- Required for planned work: the BLA-N link. If this PR came from a GitHub community issue, also add: Closes #N -->

- BLA-N:

## Evidence

<!-- Paste observed output. Evidence is required — a promise is not evidence. -->

- [ ] `npx vitest run` — full suite green

```
<paste output>
```

- [ ] `npx tsc --noEmit` — clean

```
<paste output>
```

- [ ] No `any` added — strict TypeScript (`unknown` + narrowing instead)

## Review workload

- Changed lines: ~___ (+___ / −___)
- [ ] Single work unit (≤ ~400 authored lines) — or chained PRs linked below
- Chain: <!-- e.g. PR #12 → PR #13; delete if standalone -->

## Merge checklist

- [ ] Branch cut from `dev`; PR targets `dev`
- [ ] All conversations resolved before merge
- [ ] Merge-commit subject is conventional: `chore: merge PR #N — <type>: <summary>`

## Contract checks (reviewers look here first)

- [ ] Spec passed **by reference** (`odd/tasks/…` path) — never paraphrased
- [ ] No SDD artifacts introduced (TaskContract only)
- [ ] No sub-subagent spawning (flat tree)
- [ ] Delegation still triggers by named reason, never by size
- [ ] Verifier changes invoke the review authority — never replace it

## Roadmap

- Phase: <!-- Phase N from ROADMAP.md, or "not roadmap-tracked" -->
