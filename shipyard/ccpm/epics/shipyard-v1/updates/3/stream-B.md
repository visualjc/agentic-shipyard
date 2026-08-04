---
issue: 3
stream: B — Isolated worktree creation and optimistic Git ledger
status: implemented
---

Own only `src/ledger/**`, `src/adapters/ledger-git.ts`, `src/workspace/**`,
`test/ledger/**`, and `test/integration/delivery-workspace/**`.  Consume A's
published ports.  Do not alter the existing generic Git adapter, implement
context roles, or introduce any GitHub/provider/credential behavior.

## Delivered

- `LedgerStore` provides pinned snapshots and expected-head transactions; its
  pure transaction validator rejects stale heads, duplicate/unsafe paths, and
  same-path semantic conflicts before a candidate write is emitted.
- `GitLedgerStore` maintains `refs/heads/shipyard-ledger` using Git objects,
  temporary indexes, and compare-and-swap `update-ref`.  It never checks the
  ledger out in a product worktree and has an explicit destination-ref
  exclusion predicate.
- `WorkspaceService` creates/resumes a stable delivery registration, feature
  branch/worktree, and initial durable record; it supports interrupted resume,
  worktree recreation, authoritative-main rejection, conflict detection, and
  cleanup that removes only rebuildable local state.
- Focused tests cover the pure optimistic transaction cases, lifecycle resume
  and cleanup behavior, and disposable local-Git orphan ancestry/refspec
  isolation.  Shared full-suite verification is pending the concurrently owned
  Stream C test compilation fix.
