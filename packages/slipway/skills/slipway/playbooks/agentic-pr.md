# Agentic PR lifecycle

Use the agentic PR as a private development/review workspace. Do not treat it as the team feedback or merge surface.

## Create or update

1. Verify the agentic repository/account, work branch, agentic-main base, exact head, existing PR search, recovery path, and exact review-base/candidate range. Inspect every commit patch and resulting tree in `review-base..candidate`, as well as the final diff and tracked state. Reject any materialized worktree-root private overlay path or private-policy content in public instructions found anywhere in that history, even when a later commit deletes it; the final diff check is necessary but insufficient. Reviewed Slipway template assets under an included product path are not materialized overlay files.
2. Show the exact ordinary branch push and PR create/update operations. Require authority for those provider writes; never force-push by default.
3. Push the exact candidate when authorized and create at most one agentic PR for the run, or verify the existing one targets the correct base and branch.
4. Record its canonical URL, provider ID, base, head, and state in the manifest and an immutable event.
5. Keep independent review tied to the exact candidate SHA. Do not expect team feedback on this PR.

## Close without merge

After human delivery merge and authoritative main synchronization, verify the recorded agentic PR still belongs to the run and was never merged. Show the exact close-without-merge operation, require provider-write authority, close it, verify `closed` and `unmerged`, then record the result. Never merge it.
