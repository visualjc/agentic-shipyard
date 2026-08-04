---
issue: 8
updated: 2026-08-04T00:00:00Z
status: planned-blocked
progress: 0%
blocked_by: [6, 7]
---

# Execution Record: Issue #8

`../../8-analysis.md` is the controlling plan for the single-repository path.
Implementation is blocked until Issue #6's exact-SHA acceptance/review authority
and Issue #7's shared manifest/dispatcher/checkpoint APIs are independently
accepted and integrated at one product SHA. Current branches, task checkboxes,
GitHub PR state, and prototypes are not substitutes for either gate.

When unblocked, execute three serialized boundaries: pure single-repository
certification state; a locked operation that certifies and idempotently updates
one existing same-repository PR only; then post-human-merge finalization and
recovery. The sole PR must have the exact current accepted/reviewed head and a
fresh permitted-path receipt. Prohibited/unclassified metadata, stale evidence,
accepted findings, wrong/replaced/retargeted/cross-repository PRs, or any
ambiguous observation block before a provider write.

Shipyard must neither create a second/fork PR nor merge. It observes human
merge of the expected head, then resumes ledger seal, development-only reviewed
tag, main verification/sync, owned tracked-record closure, and proven delivery
branch cleanup from durable checkpoints. No retry may duplicate a PR/dossier,
merge, erase a human update, or delete a replacement resource.

Use only disposable local Git and fake-provider coverage for this issue. The
live private-fixture allowlist remains empty: no live GitHub, remote transport,
`NativeInteractive`, retired fixture, or Just Games mutation is authorized.
Exact-SHA evidence and independent review must state that the live gate was
skipped rather than imply it ran. Broad CLI/skill orchestration remains Task
#9's ownership; #8 contributes a narrow typed handoff and status facts only.
