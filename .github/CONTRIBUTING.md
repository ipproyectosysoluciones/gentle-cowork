# Contributing to gentle-cowork

Thank you for contributing. `gentle-cowork` is a **contract-driven repository**: the workflow below is binding, not advisory. It follows the gentle-ecosystem contribution chain — issue → branch → work-unit commits → PR → review — with Linear as the tracking system and the gentle-ai review authority as the final gate.

Read these first:

- [`README.md`](README.md) — what the project is and its design principles
- [`ROADMAP.md`](ROADMAP.md) — phases, exit criteria, and the binding **Non-goals**
- [`CODE_OF_CONDUCT.md`](.github/CODE_OF_CONDUCT.md) — direct, technical, respectful, evidence-first

## Issue-first workflow (Linear)

All planned work is tracked in **Linear** (team `BLA`, project *gentle-cowork*):

1. **Community reports** — file a GitHub issue using the [issue templates](.github/ISSUE_TEMPLATE/). Evidence is required and free-form ("blank") issues are disabled. Maintainers triage the report into Linear as `BLA-N`.
2. **Every PR references its Linear issue** as `BLA-N` in the PR description (commit footers may carry it too). If the PR resolves a GitHub community issue, also write `Closes #N`.
3. **Statuses update with proof**: `In Progress` must reference the working branch; `Done` requires the commit hash plus test evidence. "It works" is not evidence.
4. **Small, fully-understood work** may be handled inline without a Linear issue (per the `gentle-linear` contract). When in doubt, open one.

## Branch model

| Branch | Role | Protection |
|---|---|---|
| `main` | Stable, release branch | PR + 1 required review, dismiss stale reviews, **linear history**, no force push, no deletions, conversation resolution required |
| `dev` | Integration branch — all work PRs land here | PR required |

- **Feature branches** are cut **from `dev`** and named `feat/BLA-N-<short>` or `fix/BLA-N-<short>` (e.g. `fix/BLA-31-verifier-retry`).
- **PRs target `dev`.** Never commit directly to `main` or `dev`.
- **Releases** flow `dev` → `main` through an automated release PR created by [release-please](https://github.com/googleapis/release-please) (see [Versioning](README.md#versioning)). Merging the release PR tags the version; the version bump is then merged back into `dev`.

## Commits — Conventional Commits in work-unit slices

Every commit title follows the Conventional Commits specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types (this repo):** `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.
**Breaking changes:** append `!` to the type and add a `BREAKING CHANGE:` footer.

Rules:

- **One logical change per commit** — a commit is a reviewable work unit (~400 authored lines max per slice).
- **Tests and docs travel with the behavior** they cover — never a separate "add tests later" commit.
- **Never mix refactoring with feature work** in the same commit.
- **Every commit title is conventional — including merge commits** (see [Merging and commit rules](#merging-and-commit-rules)).

## Pull requests

- **Target `dev`** (the only PRs targeting `main` are the automated release PRs).
- **One work unit per PR** — ≤ ~400 authored lines. Bigger changes are split into **chained PRs**: PR 1 lands first, PR 2 builds on it, and every link in the chain is a complete, reviewable unit.
- **Fill in the [PR template](PULL_REQUEST_TEMPLATE.md)** — work-unit summary, conventional commit list, `BLA-N` link, evidence, changed-line count, roadmap phase.
- **Evidence is required**: paste the actual command output (`npx vitest run`, `npx tsc --noEmit`). No evidence, no review.
- **Review expectations**: reviewers check the binding contracts first (delegate by named reason, spec by reference, no SDD artifacts, flat tree, no `any`), then the diff. Contributors respond to feedback and never self-approve.
- **Review authority chain**: the gentle-ai review is the review authority; maintainer approval gates every merge. The `cowork-verifier` role *invokes* the review authority — it never replaces it.
- **Conversations must be resolved** before merge (enforced on `main`; expected everywhere).

### Merging and commit rules

- The `validate-conventional-commits` workflow enforces **conventional-commit titles on all content commits** of a PR (merge commits are excluded from the automated check). GitHub's default merge subject (`Merge pull request #N from …`) is **not** conventional — this contract still requires editing it before merging.
- PRs merge with the **merge** method using a conventional merge-commit subject, for example:

  ```
  chore: merge PR #N — <type>: <summary>
  ```

- [`.github/CODEOWNERS`](.github/CODEOWNERS) designates `@ipproyectosysoluciones` as the **required code-owner reviewer for every PR**.

## Definition of done (before requesting review)

- [ ] `npx vitest run` — the full suite passes
- [ ] `npx tsc --noEmit` — clean
- [ ] **No `any` anywhere** — this is strict TypeScript; use `unknown` and narrow
- [ ] **Spec by reference** — subagent-facing work references `odd/tasks/<feature>.md` by path. Never paraphrase a spec in an issue, PR description, or prompt — link the source document.

## Orchestration contracts (changes touching delegation)

These come from the ROADMAP and are non-negotiable in review:

- **Delegate by named reason, never by size.** Orchestration activates only when a valid delegation reason exists — never because a task "looks big".
- **Flat delegation tree.** Subagents never spawn sub-subagents.
- **No SDD artifacts.** A `TaskContract` is all a delegation carries — no formal proposal/spec/design documents.
- **Invisible to ODD.** Normal flows require no `/cowork` invocation; the `tool_call` hook intercepts only delegation that already has a named reason.

## Language boundary

All technical artifacts — issues, PRs, reviews, commits, code, code comments, and documentation — are written in **English**. Always.

## Security

Never paste secrets or API keys in issues, PRs, or patches. Report vulnerabilities privately — see [SECURITY.md](.github/SECURITY.md).

## License

By contributing, you agree your work is licensed under the repository's [MIT license](LICENSE).
