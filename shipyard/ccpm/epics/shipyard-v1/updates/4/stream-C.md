---
issue: 4
stream: C — Scoped authenticated Git transport and recovery documentation
status: implemented
---

Own only the separate Git-transport boundary, credential/redaction tests, and
credential/recovery documents listed in `../../4-analysis.md`.  Disable
inherited credential helpers, pass credentials only through ephemeral
environment state, and do not extend the Issue #2 Git identity adapter or add
sync behavior.

Implemented the separate `GitTransportCommandRunner`/`GitTransportService`
boundary. Each invocation executes `git` only, supplies
`credential.helper=` as command-scoped configuration, places the transport
authorization value only in the child environment, disables terminal prompts,
rejects token-bearing argv/remote URLs, and redacts token/header/user-info
material from both successful output and failures. No `gh` command or global
GitHub CLI mutation path exists.

Added credential separation and safe recovery/opt-in private-fixture guidance
in `docs/credentials.md` and `docs/github-tracking-recovery.md`, including the
no-`NativeInteractive` / no-real-call-by-default constraint.

Verification: aggregate `npm run build` passed. Compiled deterministic
transport/redaction tests passed (6 tests, 0 failures). An earlier build
attempt observed concurrently owned Stream A files while incomplete; the
post-integration rerun is green.
