# Prototype worktree graph freshness

Type: prototype  
Status: resolved  
Blocked by: 11, 12

## Question

For each viable graph tool, can Shipyard reuse an exact-main baseline while
maintaining independent, incrementally fresh graph state for divergent
worktrees and later agent sessions?

Use a synthetic feature in which session one changes a call graph and session
two must observe that changed graph. A sibling feature must not observe it. Then
advance authoritative `main`, refresh the feature, and verify the resulting
graph contains both the baseline and feature changes.

Measure initial build, seed, and incremental-refresh cost. Test uncommitted
edits, commits, checkout, rebase, process restart, worktree recreation, stale
locks, and unavailable tools. Verify that stale state is surfaced and that
fallback to direct source inspection is safe. Run CodeGraph, Graphify, and
Understand Anything independently so failures are attributable.

The answer should select only empirically reliable v1 guarantees; attractive
but unsupported cache sharing remains deferred.

## Comments

- Blocked by official-tool research and the local fixture.
- Do not use proprietary JustGames code without an approved provider/privacy
  configuration.

## Answer

The exact-source synthetic exercise passed 21 assertions. Graphify and
CodeGraph both reused exact-main seeds, isolated divergent worktrees, detected
uncommitted and committed call-graph changes, survived fresh processes, handled
rebase and checkout, and reused private caches after same-path worktree
recreation. They remain optional experimental candidates rather than universal
v1 dependencies.

Graphify requires both an absolute `GRAPHIFY_OUT` and `--out`; `--out` alone
leaked a cache file into the worktree. CodeGraph requires a runtime FTS5 probe
(default Node 22.13.0 failed; installed Node 24.13.1 passed) and a machine-local
`.codegraph/` Git exclusion. Its copied-cache seeding worked empirically but is
not an upstream guarantee.

Understand Anything's local scanner was worktree-correct only with redirect
disabled. Its semantic graph was intentionally not invoked, so authoritative
feature-worktree use remains deferred.

The runnable prototype, timings, safeguards, and full findings are under
[`../prototypes/worktree-graph-freshness/`](../prototypes/worktree-graph-freshness/).
