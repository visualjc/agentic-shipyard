---
issue: 7
updated: 2026-08-04T00:00:00Z
status: planned-blocked
progress: 0%
blocked_by: [6]
---

# Execution Record: Issue #7

`../../7-analysis.md` is the controlling staged-pair delivery plan.  This task
is deliberately blocked from implementation until Issue #6's exact-SHA
acceptance and independent-review APIs are accepted, independently reviewed,
and integrated.  The current Issue #6 branch is not authority.

When unblocked, use four bounded streams: pure promotion manifests/payload
state; locked Git-native initial/revision executor; scoped normal destination
PR bridge; then serialized human-merge finalization and recovery.  Shared
barrel, CLI/public-skill, status-shape, binding, ledger, GitHub, and sync
surfaces remain owned by their existing tasks and require explicit handoff.

All tests are deterministic local Git and fake-provider tests.  This task must
not contact GitHub, mutate a remote, use `NativeInteractive`, or reuse the
retired private fixture.  A final claim must explicitly distinguish those
deterministic results from the separately unapproved live-fixture gate.

Initial promotion, each revision, and finalization fail closed on any stale
binding/actor/ref/path/evidence/manifest/provider observation.  The destination
PR is a normal destination-owned non-fork PR; destination feedback returns to
the development branch for a new accepted/reviewed SHA, then appends one
sanitized descendant destination commit without force push.  Shipyard never
merges.  Post-merge finalization is checkpointed/resumable: seal ledger, tag
development-only reviewed SHA, exactly sync mains, close development PR without
merge, close the development issue, and delete only proven delivery branches.
