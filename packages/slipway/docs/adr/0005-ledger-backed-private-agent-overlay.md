# ADR-0005: Ledger-backed private agent overlay

## Status

Accepted.

## Context

The delivery repository must remain usable by teammates who do not install the
private agentic repository's skills. Project-wide agent policy such as Matt
skill setup, CodeGraph guidance, or other personal tooling therefore cannot be
committed to shared `AGENTS.md`, `CLAUDE.md`, or `docs/agents/**`. Repeating
private metadata commits on every work branch is noisy, while a long-lived
overlay branch adds another ancestry and synchronization lifecycle.

## Decision

Keep one canonical private overlay at `.slipway/agent-overlay/` on the parallel
ledger branch. Version it with the Git tree object ID of that directory, so
unrelated ledger commits do not change the overlay version. Materialize only
manifest-allowlisted `AGENTS.local.md`, `CLAUDE.local.md`, and
`docs/agents/**` files into the exact agentic worktree. Ignore them through the
Repo-B clone's repository-local Git exclude and record the hydrated tree ID in
that worktree's ignored `.slipway-local/` state.

The tracked public extension remains skill-agnostic. `AGENTS.md` may load an
optional local file without naming Slipway topology or private tools;
`CLAUDE.md` may contain only `@AGENTS.md` as its adapter. The private
`CLAUDE.local.md` contains only `@AGENTS.local.md` so policy text has one owner.

Hydration is mandatory before lane work and after worktree creation, resume,
accepted policy changes, or authoritative-main synchronization. A missing or
invalid canonical manifest or required source fails closed. Fresh absence may
hydrate from the current canonical tree. When a recorded version is stale,
Slipway accepts it only as a prior canonical tree reachable at the bound ledger
path and after validating that historical tree with the same manifest, format,
required-source, allowlist, mode, and destination rules as the current tree.
Every existing managed node, type, and byte must still match the ownership
established by that validated baseline. This permits safe installation of the
current tree and safe removal of recorded-owned obsolete paths. The current
version is recorded only after a complete post-install audit and reverification.

Invalid or unreachable versions, prior-byte, type, or ownership mismatches,
unexpected or invalid nodes, tracked private paths, and unresolved missing or
stale materialization fail closed and block lane work with one setup repair
action. Slipway never overwrites divergent local policy automatically, and
rollback after a failed write is best-effort rather than transactional.

`setup-matt-pocock-skills` may perform discovery and draft its answer, but
Slipway intercepts its normal tracked-file destination and persists the result
through the ledger overlay during an explicit project-policy/setup window.

## Consequences

- Agentic main remains an exact product-history mirror of delivery main.
- Private policy is durable and recoverable without appearing in work-branch
  history, agentic PRs, or delivery cargo.
- Every new clone or worktree depends on Slipway hydration before agent work.
- Git ignore is concealment, not enforcement; delivery gates still inspect
  tracked paths, diffs, commits, changed public instructions, and the bound
  canonical overlay.
- Host-specific loading behavior requires separate fresh-context validation;
  its evidence remains outside delivery cargo.
