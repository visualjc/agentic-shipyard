# Run start contract

Use this contract before every product-development, bug-investigation, research, or prototype lane.

1. Verify the paired repositories, clean agentic-main worktree, exact agentic-main SHA, and its known relationship to authoritative delivery main. Stop for synchronization when agentic main is stale or divergent.
2. Require a complete proposed work-branch name. Validate it with `git check-ref-format --branch`, then enforce the identity, non-reuse, and slash-prefix rules in [store.md](store.md).
3. Verify an existing work branch started at the recorded agentic-main SHA, or report and perform the exact branch/worktree creation operation from that SHA as normal local run initialization. Do not add a human gate unless project policy requires one. Never create it from another feature branch, the ledger branch, or an unverified moving ref.
4. Verify the resulting worktree is on the expected work branch. Never develop, diagnose, write planning artifacts, research, or prototype on agentic main, delivery main, or the ledger branch.
5. Confirm the mandatory [private context lifecycle](store.md#private-context-lifecycle) already loaded baseline `operations: [all]` coordinator modules before classification. Validate and safely cache the exact ledger context tree under ignored `.slipway-local/context/`, preserve unrelated clone-local exclusions, resolve the additional modules for this operation, and load every required coordinator-targeted entrypoint. Because lane execution mutates workflow state, do not start it until required context is healthy and loaded; the read-only fallback never applies to lane execution. Never overwrite divergent cached bytes automatically.
6. Create or reconcile the matching branch-named ledger shard with the exact agentic base SHA and worktree pointer before lane work begins.
7. Read the project's `Matt project setup` state. When it is `first-run-required`, allow `setup-matt-pocock-skills` discovery, questions, and confirmed draft generation on this work branch, but intercept its tracked-file write destination. Persist the private draft in `.slipway/context/modules/matt-skills/` during an explicit ledger project-policy/setup window, refresh and verify the ignored context cache, then mark the ledger project state `complete`. Never create or edit a tracked instruction file merely to bootstrap Slipway.

If any identity, base, ancestry, worktree, or shard claim conflicts, stop and record one reconciliation action instead of guessing.
