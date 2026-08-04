# Promotion and finalization recovery

Retry the same trusted operation with only the delivery ID. Do not manually rewrite the promotion manifest, journal, finalization intent, receipt, destination branch, reviewed tag, or ledger ref to make a retry pass.

## Safe automatic recovery

- A destination commit was pushed but its ledger checkpoint was interrupted: Shipyard rebuilds the deterministic commit from the recorded parent and exact reviewed SHA. It adopts the remote head only if the object IDs match exactly.
- A marked destination PR was created but not checkpointed: Shipyard exhaustively discovers the unique marker, verifies its same-repository head/base/SHA, and records it. A duplicate or replacement blocks.
- A finalization provider mutation succeeded but its journal append was interrupted: Shipyard re-observes the exact immutable record and continues if the completed state matches.
- A branch deletion succeeded but its completion checkpoint was interrupted: Shipyard accepts the exact branch absence only when the immutable deletion-intent checkpoint was already durable; otherwise absence blocks.
- A tag, main sync, branch deletion, final receipt, seal, or seal publication is already complete: Shipyard verifies the exact expected state and continues without recreating a different object or repeating an unsafe mutation.

## Manual inspection blockers

Stop and inspect when a destination branch is not the recorded head or deterministic next commit; destination `main` moved during an active unmerged delivery; evidence, policy, actor, binding, or path ownership changed; a PR was retargeted/replaced/forked; development records changed identity or the development PR was merged; a tag/ref/worktree is owned by another state; a worktree is dirty; main cannot fast-forward; or a ledger CAS/seal no longer matches.

Shipyard does not repair these states with merge, rebase, reset, amend, force-push, resource recreation, or broad deletion. Preserve user work and reconcile the external state explicitly before a new reviewed operation.

## Test boundary

Issue #7 is verified with deterministic fake-provider and disposable local Git fixtures. Authenticated execution against a private synthetic GitHub repository remains unauthorized and was skipped. A future live probe requires a separately reviewed, code-owned repository/actor allowlist; the retired private fixture must not be reused, renamed, or deleted.

The single-repository topology uses the same exact-state journal, deletion-intent, merge-verification, main-CAS, owned-cleanup, and seal-last rules without emulating a second PR or destination branch. See [single-repository recovery](single-repository-recovery.md) for its topology-specific dossier, ready-state, issue, and one-branch checkpoints.
