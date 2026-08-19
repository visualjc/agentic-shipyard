# Run start contract

Use this contract before every product-development, bug-investigation, research, or prototype lane.

1. Verify the paired repositories, clean agentic-main worktree, exact agentic-main SHA, and its known relationship to authoritative delivery main. Stop for synchronization when agentic main is stale or divergent.
2. Require a complete proposed work-branch name. Validate it with `git check-ref-format --branch`, then enforce the identity, non-reuse, and slash-prefix rules in [store.md](store.md).
3. Verify an existing work branch started at the recorded agentic-main SHA, or report and perform the exact branch/worktree creation operation from that SHA as normal local run initialization. Do not add a human gate unless project policy requires one. Never create it from another feature branch, the ledger branch, or an unverified moving ref.
4. Verify the resulting worktree is on the expected work branch. Never develop, diagnose, write planning artifacts, research, or prototype on agentic main, delivery main, or the ledger branch.
5. Before any lane work, apply the complete authoritative [overlay lifecycle](store.md#overlay-lifecycle), including its fail-closed canonical and historical-baseline validation, safe hydration, audit, version recording, and reverification. Add only `/AGENTS.local.md`, `/CLAUDE.local.md`, `/docs/agents/`, and `/.slipway-local/` to the Repo-B clone's repository-local Git exclude shared by its linked worktrees. Do not start the lane until the overlay is healthy; route unresolved unsafe state only to the lifecycle's explicit setup repair action, and never overwrite divergent local edits automatically.
6. Create or reconcile the matching branch-named ledger shard with the exact agentic base SHA and worktree pointer before lane work begins.
7. Read the project's `Matt project setup` state. When it is `first-run-required`, allow `setup-matt-pocock-skills` discovery, questions, and confirmed draft generation on this work branch, but intercept its tracked-file write destination. Persist the draft in canonical `AGENTS.local.md` and `docs/agents/**` during an explicit ledger project-policy/setup window, retain the one-line local Claude adapter, rehydrate and verify, then mark the ledger project state `complete`. Block lane work if delegation, ledger persistence, or local verification fails.

If any identity, base, ancestry, worktree, or shard claim conflicts, stop and record one reconciliation action instead of guessing.
