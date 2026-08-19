# Synchronization and finalization

## Synchronize delivery main to agentic main

1. Verify both repositories/worktrees, provider identity, remotes, clean state, exact main refs, ancestry, and active work branches read-only.
2. Require the intended delivery-main SHA to descend from agentic main. If not, report divergence and stop; do not manufacture a tree snapshot, merge, rebase, or discard agentic work.
3. Show the exact local fast-forward operation and recovery point. After approved local mutation, fast-forward agentic main to the authoritative delivery-main commit and verify both local refs resolve to the same SHA.
4. Only after that clean fast-forward, resolve the canonical overlay tree, validate it, and rehydrate/byte-verify the affected Repo-B agentic-main worktree. Do not copy overlay files into main history.
5. If the bound agentic main also exists on a remote, separately preflight and authorize an ordinary fast-forward push, then verify the remote ref. Never force-push it.
6. For other active work branches, record the new baseline and open an explicit merge/rebase reconciliation gate according to project policy. Do not silently rewrite or merge into them. Re-check their overlay before any resumed work.
7. Never merge an agentic work branch or agentic PR into agentic main. Never copy agentic-only metadata onto main.
8. For a human-merged run whose mains now match, use [agentic-pr.md](agentic-pr.md) to close its recorded agentic PR without merge under a separate provider-write gate. Verify and record `closed` and `unmerged` before routing to finalization.

## Finalize after human merge

Require all conditions, including agentic-PR closure already completed during post-merge synchronization:

- the delivery PR was human-merged and its merge/result SHA is observed;
- delivery main and agentic main resolve to the same authoritative SHA;
- the agentic PR is closed without merge;
- every accepted feedback item maps through a reviewed agentic head and cargo commits to the delivery PR;
- final QA/review, delivery, agentic, and ledger SHAs are recorded;
- development-only artifacts have a retained tag or archive pointer;
- no worker, unresolved feedback, or gate remains active.

Create the compressed branch-specific archive summary and remove the matching active run files by exact path in one scoped ledger commit. Do not recursively remove the run directory; prune only confirmed-empty directories. Git history retains detailed events. Branch/tag deletion remains human-gated. Do not finalize an open delivery PR or create a second run for in-scope PR feedback.
