---
name: gentle-contributions
description: "Use for contributing to gentle-ai upstream repos: create issues with evidence, PRs with conventional commits, follow the review authority chain (gentle-ai > gentle-shell > contributor). Always document in Linear."
---

# gentle-contributions — Upstream Contribution Workflow

Use this skill when contributing to gentle-ai upstream repositories (gentle-dot, gentle-shell, gentle-ai). Covers the full lifecycle: issue → branch → commit → PR → review.

## The Contribution Chain

```
1. Discover → 2. Document → 3. File Issue → 4. Branch → 5. Commit → 6. PR → 7. Review
   (local)      (Engram)      (GitHub)       (fork)    (conventional) (upstream)  (gentle-ai)
```

## Step 1 — Discover

Find a bug, missing feature, or improvement through real usage. Do NOT file speculative issues.

## Step 2 — Document

Before filing an issue, gather evidence:
- Reproduce the bug (or demonstrate the missing feature)
- Capture logs, error messages, or measurable impact
- Save findings to Engram (topic_key = `<repo>-<issue-topic>`)
- Rule: GitHub issues/PRs/comments ALWAYS in English

## Step 3 — File Issue (GitHub)

Create the issue in the upstream repo following gentle-ai conventions:

1. **Title**: Clear, specific, searchable (no "fix bug" titles)
2. **Body**: What happened → Expected behavior → Steps to reproduce → Evidence
3. **Labels**: Use the repo's existing labels
4. **Language**: English ALWAYS for upstream repos

### Issue templates by type

**Bug report:**
```markdown
## Bug
What happened (one sentence)

## Expected
What should have happened

## Reproduce
Steps to reproduce

## Evidence
Logs, screenshots, or error messages

## Environment
OS, version, relevant config
```

**Feature request:**
```markdown
## Problem
What limitation or gap this addresses

## Proposal
What to build and why it fits the project

## Impact
Who benefits and how
```

## Step 4 — Branch

Create a feature branch from the fork:

```bash
git checkout -b fix/<issue-number>-<short-description>
# or
git checkout -b feat/<short-description>
```

## Step 5 — Commit (Conventional Commits)

Every commit follows the Conventional Commits specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation only
- `refactor` — code change that neither fixes nor adds
- `test` — adding or fixing tests
- `chore` — maintenance, deps, config

**Examples:**
```
feat(bridge): add origin labels for channel identity
fix(daemon): handle MCP request timeout gracefully
docs(readme): add architecture diagram with Mermaid
```

**Rules:**
- One logical change per commit (work-unit commits)
- Tests and docs go with the behavior they cover
- Never mix refactoring with feature work in the same commit

## Step 6 — Pull Request

Create the PR from the fork to the upstream repo:

1. **Title**: Same conventional format as the primary commit
2. **Description**: Link the issue ("Closes #N"), summarize the change
3. **Evidence**: Test results, before/after, screenshots if UI
4. **Check**: Ensure CI passes before requesting review

### PR checklist
- [ ] Conventional commit title
- [ ] Closes the referenced issue
- [ ] Tests pass locally
- [ ] No breaking changes (or breaking changes documented)
- [ ] Documentation updated (if applicable)

## Step 7 — Review (gentle-ai authority)

The review process follows the gentle-ai authority chain:

1. **gentle-ai review** — the Go binary is the review authority
2. **Maintainer approval** — required for merge
3. **Contributor** — responds to feedback, does NOT self-approve

## Linear Integration

After filing the GitHub issue and creating the PR, create a Linear issue to track the contribution internally:

1. **Create Linear issue** referencing the GitHub issue number
2. **Status**: In Progress when the branch is created
3. **Done** when the PR is merged upstream
4. **Label**: `upstream` (to distinguish from internal work)

## Anti-patterns

- Never commit directly to main/development
- Never file issues without reproduction evidence
- Never self-approve PRs
- Never mix upstream contributions with internal-only work in the same branch
- Never paraphrase specs in PR descriptions — link to the source
- Never write upstream issues/PRs in Spanish (English ALWAYS for public repos)
