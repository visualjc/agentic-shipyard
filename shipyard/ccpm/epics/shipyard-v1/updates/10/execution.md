---
issue: 10
updated: 2026-08-04T00:00:00Z
status: planned
progress: 0%
product_head_at_analysis: 972cb1b75e6bca766a9489fd928e17431ad9fee1
---

# Execution Record: Issue #10

Implementation has not started. `../../10-analysis.md` is the controlling
plan.  Stream A first publishes the pure graph authority/fingerprint/fake
contracts.  Streams B (Graphify) and C (CodeGraph) may then run in parallel in
their disjoint files.  Stream D alone performs the delayed shared status and
public-export handoff after B/C pass.

Graphs are experimental and disabled by default.  Exact current commit plus
working-tree fingerprint, reviewed tool receipt, canonical worktree root, and
private per-worktree cache identity are all required for freshness.  A stale,
failed, blocked, invalid, unavailable, or disabled graph must direct the agent
to inspect source; it cannot block source-based development or be authoritative.
Divergent worktrees never share mutable graph/cache/lock state.

Graphify must use code-only mode, disabled query logging, matching absolute
`GRAPHIFY_OUT` and `--out`, and verify relocation after each seed/refresh.
CodeGraph must prove actual Node/SQLite FTS5 capability, telemetry-off state,
and machine-local `.codegraph/` exclusion before use.  Its copied-cache seed is
documented only as empirical at the reviewed pin, not upstream guaranteed.
Understand Anything is deferred and must not appear as authoritative
feature-worktree state.

All required tests use deterministic fake adapters and disposable local Git;
they do not install external tools, contact providers, enable telemetry, or
send proprietary code.  Before a stream starts, record its exact owned files,
published API inventory, test commands/results, and handoff here.  Before
completion, an integration verifier records the exact final product SHA, clean
working-tree fingerprint, test evidence, and independent review; CCPM/GitHub
state and tool self-report are non-authoritative.
