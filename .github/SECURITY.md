# Security Policy

## Reporting a vulnerability

**Report privately via GitHub Security Advisories:** in this repository, go to **Security → Advisories** and use **"Report a new vulnerability"**.

Never open a public issue for a suspected vulnerability — not even an "is this a vulnerability?" issue.

Include in your report:

- Description of the issue and the affected surface (the extension in `src/`, the role prompts in `agents/`, the blackboard state, or the repository workflows)
- Affected version or commit
- Reproduction steps or a proof of concept
- Assessed impact

Maintainers will acknowledge the report and keep you informed of progress. Please allow a reasonable window for a fix before any public disclosure.

## What never goes in a public artifact

Never paste secrets, API keys, tokens, or credentials in issues, PRs, code review comments, patches, or pasted logs — even expired or partially redacted ones. Redact before pasting. If a secret has been exposed anywhere, report it privately and rotate it.

## What counts as a security issue in this repository

gentle-cowork spawns subagents and persists orchestration state, so three surfaces are security-relevant:

1. **Subagent spawning** — anything that lets crafted input (a delegated prompt, or file content a subagent reads) spawn unintended subagent processes, escape a role's permission envelope (`cowork-planner` is read-only, `cowork-implementer` is scoped-write, `cowork-verifier` is read + tests), or spawn sub-subagents through the extension.
2. **Contract persistence** — the blackboard state file: tampering with another task's `TaskContract` (scope, status, acceptance criteria), path traversal in state-file reads or writes, or state written outside its expected location (`.gentle-cowork/`).
3. **Credential handling** — the extension or any role reading, logging, or persisting credentials, tokens, or secrets (for example, environment variables leaking into the blackboard state or into subagent logs).

## Supported versions

| Version | Supported |
|---|---|
| Latest release (once published) | Yes |
| `main` / `dev` heads | Yes |
| Anything else | No |

No release has been tagged yet; the `main` and `dev` heads are the supported surfaces.

## Out of scope

- Vulnerabilities in Pi, gentle-shell, or other gentle-ecosystem components — report them to their own repositories.
- Your own agent configuration, custom prompts, or machine hardening.
