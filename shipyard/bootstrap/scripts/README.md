# Agentic Shipyard bootstrap guards

These scripts exist only to bootstrap Shipyard before Shipyard can enforce its
own policies. They are copied to the development-only ledger and excluded from
product `main`.

## CCPM ledger bridge

The pinned CCPM fork hardcodes `.claude/`. The bridge verifies the exact
development origin, sole remote, shared Git common directory, `main` product
checkout, and `shipyard-ledger` worktree before creating an ignored symlink:

```text
<development>/.claude -> <ledger>/shipyard/ccpm
```

Run:

```sh
node bootstrap/ccpm-ledger-bridge.mjs \
  --repo-root /Users/jimcarter/projects/computer-management/shipyard \
  --ledger-root /Users/jimcarter/projects/computer-management/shipyard-worktrees/shipyard-ledger
```

## Guarded issue synchronization

The issue synchronizer refuses any target or actor other than the exact
bootstrap policy, verifies the GitHub API identity through a command-scoped
token, creates/reuses stable marker-tagged issues, rewrites CCPM task files to
their GitHub issue numbers, and confirms the destination has no workflow issue.

Run only after the bridge and ledger planning records exist:

```sh
node bootstrap/sync-ccpm-issues.mjs \
  --repo-root /Users/jimcarter/projects/computer-management/shipyard \
  --ledger-root /Users/jimcarter/projects/computer-management/shipyard-worktrees/shipyard-ledger
```

The scripts never switch the global GitHub CLI account and never invoke Claude
Code or Cursor.
