# Run start contract

Use this contract before every product-development, bug-investigation, research, or prototype lane.

1. Verify the paired repositories, clean agentic-main worktree, exact agentic-main SHA, and its known relationship to authoritative delivery main. Stop for synchronization when agentic main is stale or divergent.
2. Require a complete proposed work-branch name. Validate it with `git check-ref-format --branch`, then enforce the identity, non-reuse, and slash-prefix rules in [store.md](store.md).
3. Verify an existing work branch started at the recorded agentic-main SHA, or report and perform the exact branch/worktree creation operation from that SHA as normal local run initialization. Do not add a human gate unless project policy requires one. Never create it from another feature branch, the ledger branch, or an unverified moving ref.
4. Verify the resulting worktree is on the expected work branch. Never develop, diagnose, write planning artifacts, research, or prototype on agentic main, delivery main, or the ledger branch.
5. Create or reconcile the matching branch-named ledger shard with the exact agentic base SHA and worktree pointer before lane work begins.
6. Read the project's `Matt project setup` state. When it is `first-run-required`, invoke `setup-matt-pocock-skills` now on this work branch, verify its tracker, labels, and document-layout output, commit that output as agentic metadata separate from product cargo, then update the ledger project state to `complete`. Block lane work if delegation, verification, the metadata commit, or state reconciliation fails.

If any identity, base, ancestry, worktree, or shard claim conflicts, stop and record one reconciliation action instead of guessing.
