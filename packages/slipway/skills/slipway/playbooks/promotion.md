# Promote reviewed cargo

1. Require a recorded open agentic PR, a passing [exact-SHA delivery gate](../references/delivery-gate.md) for its current head, and an ordered list of product-only commits.
2. Read-only preflight the agentic worktree/branch/head, delivery worktree/repository/base/branch/head, provider account, PR or intended PR, remotes, object availability, cargo policy, and recovery point.
3. Inspect every cargo commit and combined patch against the confirmed project cargo policy. Reject mixed commits rather than filtering them during transfer. Reject ledger `.slipway/context/**`, worktree `.slipway-local/**`, any tracked bootstrap created only for Slipway, and private-context content leaked into tracked instruction files. A reviewed Slipway context template under an explicitly included product path is ordinary product source.
4. Show exact would-be cherry-pick, verification, push, and PR create/update operations. Stop at `preflighted` without authority for the exact external writes.
5. After authorization, cherry-pick the exact commits in order onto the delivery PR branch. Stop on conflict; do not implement or improvise a delivery-only fix.
6. Verify the delivery diff is patch-equivalent to the reviewed product patch and contains no excluded materialized path or leaked private policy in public instructions. Observe the new delivery head before any authorized push.
7. Append immutable promotion/revision evidence linking the reviewed agentic head, cargo commits, delivery heads before/after, QA/review, and delivery PR. Enter delivery follow-up.

Never change global authentication, rewrite remotes, force-push by default, or merge.
