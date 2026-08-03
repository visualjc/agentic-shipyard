# Prototype ledger checkpointing and context resolution

Type: prototype  
Status: resolved  
Blocked by: 12

## Question

Can a parallel ledger worktree safely checkpoint concurrent delivery records and
provide deterministic, pinned, role-aware context to tasks working in product
worktrees without switching branches or loading unnecessary data?

The prototype should test delivery inference from a bound main clone and linked
worktrees, explicit disambiguation, ledger commit races, product-SHA/ledger-SHA
cross-linking, progressive record loading for planner/implementer/reviewer/
promoter roles, and final archival plus tag verification. It must show that a
product branch and personal PR remain metadata-free while the development Git
repository retains durable records.

The answer should decide whether a deterministic resolver is sufficient for v1
or a more stateful broker is required. A persistent autonomous Shipyard agent is
not assumed.

## Comments

- Blocked until the local lifecycle fixture establishes the branch/ref model.

## Answer

Yes. A deterministic resolver plus a machine-local delivery registry and short
optimistic ledger transactions is sufficient for v1; a persistent autonomous
broker is unnecessary. The synthetic prototype passed 16 assertions covering
worktree inference, explicit disambiguation, stale-writer retry without lost
records, exact product/ledger cross-linking, role-specific progressive loading,
old-envelope reproducibility, metadata-free product branches, and final archive
plus tag retention.

Tasks read pinned ledger objects through Git without switching the product
worktree. Product-SHA changes invalidate old envelopes. Production must retain
expected-head comparison, same-path conflict detection, short locking,
idempotent retry, and verified stale-lock recovery.

The runnable prototype and full findings are under
[`../prototypes/ledger-context/`](../prototypes/ledger-context/).
