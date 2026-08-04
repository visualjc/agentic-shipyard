---
issue: 5
updated: 2026-08-04T00:00:00Z
status: planned
progress: 0%
---

# Execution Record: Issue #5

Implementation has not started. `../../5-analysis.md` is the controlling
three-stream plan: A owns pure sync authority/provenance/status contracts; B
owns the sole locked Git baseline/source-ref mutation service; C performs the
delayed command, read-only-status, docs, and public-surface handoff.

Before any stream starts, it must record its actual exclusive files, published
API inventory, exact test command/results, and handoff in this directory.
The shared classifier and mutation lock are mandatory. Sync must retain
command-scoped `visualjc` authority, never mutate `NativeInteractive`, never
switch ambient `gh` identity, and never automatically rebase, repair, promote,
or finalize. Source refs remain policy-read-only, provenance-checked objects
under `refs/shipyard/source/...`, excluded from product refspecs/payloads.

No stream may claim acceptance or independent-review completion. Those require
the final exact product SHA, AC-005/AC-006 evidence, the adversarial
SHA-1/SHA-256 local-Git matrix, a read-only status probe, and separate
independent review.
