# Disposable host context-handoff prototype

Question: can Shipyard dispatch one explicit, pinned context envelope to
independent Codex worker processes while preserving role-based progressive
loading and rejecting stale context before any ledger record is loaded?

Run the synthetic exercise:

```sh
node prototype.mjs --exercise
```

Explore the pure dispatch state by hand:

```sh
node prototype.mjs
```

The exercise creates a temporary Git repository, orphan ledger branch, an exact
CCPM skill copy, a project-local Shipyard adapter skill, and machine-local
envelopes. Codex processes run read-only and ephemerally. No host is asked to
delegate to a child agent.

Claude Code and Cursor/Pstack live invocation are deliberately deferred because
those hosts are authenticated with Just Games identities. No fixture context is
sent to either host. Their adapter and account-switching behavior remain open
follow-up evidence; only Codex is exercised here.

This is disposable evidence, not production adapter code.
