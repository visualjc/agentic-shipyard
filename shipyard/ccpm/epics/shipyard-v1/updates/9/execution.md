---
issue: 9
updated: 2026-08-04T00:00:00Z
status: planned-blocked
progress: 0%
blocked_by: [6, 7, 8]
---

# Execution Record: Issue #9

`../../9-analysis.md` is the controlling plan. This is the Codex-only public
orchestration slice: it verifies pinned external capabilities, records the
large/small/bug/review-only lane, and routes focused public Agent Skills to
already-governed Shipyard operations. It does not make Matt skills, CCPM, a
manifest, status, a task checkbox, or a planner into an authority boundary.

Implementation is blocked until Issue #6's accepted integrated exact-SHA
evidence/reviewer gate and the implemented Issue #7/#8 topology operation APIs
are available at reviewed product SHAs. The current Issue #5 SHA, planning
records, GitHub state, and an adapter forecast do not substitute for those
contracts. Do not invent a temporary raw CCPM, GitHub, ledger, or promotion
path to bypass the dependency frontier.

When unblocked, first implement/test the pure dependency and lane-decision
domain; then read-only receipt/discovery/runtime observation; then the
Codex-only authority-created planning adapter; finally serialize all eight
CLI/Skill/reference/export integrations. Keep each stream's file ownership in
the analysis. `src/index.ts`, CLI main/runtime, status/help, package metadata,
and README are delayed single-owner handoffs.

The exact required receipts are Matt skills
`2ab958093e83e0ec752e6c1c5932da465bf23e0c`, maintained CCPM
`cdb97474904ab2cdc7d391aa17393b444a28be3e`, and Codex CLI `0.144.4`.
Modified/missing/duplicate/incompatible items block; newer known versions are
`unverified`; nothing is auto-updated, installed, linked, deleted, or vendored.
Claude Code/CCPM and Cursor/Pstack are deferred/unsupported in v1.

All tests use deterministic fakes and disposable local repositories. They must
prove focused eight-skill package discovery, valid `agents/openai.yaml`, lane
escalation, role-minimal stale-envelope rejection, no broad authority leakage,
and every mutation's revalidation/lock gate. No live GitHub/remote transport,
`NativeInteractive`, Just Games resource, global `gh` change, or dependency
mutation is authorized by this task. Before completion, record the exact final
product SHA, clean test/package results, dependency receipts, package/discovery
proof, exact lane/evidence status, independent-review result, and explicit
live-fixture skip in durable ledger evidence.
