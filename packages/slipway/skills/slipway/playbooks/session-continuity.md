# Session pickup and safe pause

## Resume

1. Resolve the complete work-branch name. Invoke `$slipway-status` first when unknown.
2. Read the project/preferences plus that run's manifest, status, gates, artifacts, and immutable events.
3. Verify the agentic worktree, branch, exact SHAs, ledger HEAD, and worktree state. Confirm the mandatory [private context lifecycle](../references/store.md#private-context-lifecycle) loaded baseline context before the resume scan. Before any resumed lane action, allow a proven-safe missing or stale cache to refresh, then resolve and load the selected operation-specific modules. Read provider state only when the next action depends on it.
4. Reconcile observations into coordinator-owned records. A changed candidate SHA invalidates prior QA/review. A read-only resume inspection may warn and continue with degraded context, but unresolved unsafe context or a missing required module blocks resumed lane execution and routes to the one setup action defined in [store.md](../references/store.md).
5. Load only canonical artifacts needed for the recorded next action, then resume through the matching playbook.

## Pause

1. Finish the current atomic Git operation and account for active workers/reviewers.
2. Append immutable completion events and reconcile the run summary.
3. Record phase, exact refs, completed and pending work, open gates, capability needed next, and exactly one next action.
4. Commit only the exact run path on the ledger branch.
5. Report the work branch, agentic worktree, ledger worktree, ledger commit, and resume command.

A chat summary alone is not a safe pause.
