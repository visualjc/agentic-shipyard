---
issue: 11
updated: 2026-08-04T00:00:00Z
status: planned-blocked
progress: 0%
blocked_by: [6, 7, 8, 9, 10]
---

# Execution Record: Issue #11

`../../11-analysis.md` is the controlling release-gate plan. No implementation
may start until #6 and #10 are accepted and integrated and #7, #8, and #9 are
implemented, independently reviewed, and integrated at one common product SHA.
The current accepted #5 SHA is not a release candidate.

When unblocked, run bounded Streams A--C against disposable local Git and fake
adapters, then the serialized Stream D release audit. Record exact file
ownership, public handoff contracts, command/version/UTC results, candidate
SHA, and failures here before handing a shared surface to another stream.

All recovery tests interrupt every mutation checkpoint before and after its
write, restart in a fresh process, and prove either idempotent reconciliation
or an explicit manual-recovery blocker after exact ref/provider revalidation.
They must cover locks, stale/dead/live/cross-host owners, ledger CAS/seal,
source refs, review processes, both topology PR/finalization paths, cleanup,
graphs, bounded child output, redaction, and path/symlink/TOCTOU attacks.

The private synthetic GitHub fixture has no approved allowlist. It is an
external gate and is skipped by default: no live GitHub, remote transport,
global `gh` change, `NativeInteractive`, Just Games resource, token, or
production repository is authorized. Until separately authorized and passed,
the strongest truthful result is `deterministic-ready-external-gate-pending`;
the issue and release acceptance remain open. An initial PR may document that
state but cannot claim release-ready or silently treat DOD-004 as passed.
