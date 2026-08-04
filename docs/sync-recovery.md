# Sync recovery

- Dirty worktree or index: preserve or remove the changes explicitly, then run
  status before a new sync.
- Ahead or divergent `main`: inspect it manually. Shipyard never resets,
  rebases, merges, or resolves it.
- Remote/profile drift: verify the complete topology and rebind explicitly.
- Path-policy failure: correct and review the one-owner profile policy.
- Source provenance drift: import the exact named source again; never publish
  or overwrite it through a product push.
- Held or uncertain lock: identify its recorded owner and recover manually.
  Shipyard never removes an uncertain durable mutation lock automatically.
