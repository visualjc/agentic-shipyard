# Status

`shipyard-status` resolves the local binding and its named global profile on
every invocation, verifies the bound profile identity, topology, and `status`
authorization, then prints the status projection. It performs no provider
mutation, filesystem write, or mutation-lock operation. An unbound, stale,
missing, malformed, changed, or unauthorized profile reports deterministic
setup/rebind guidance.

Sync status derives baseline freshness from the current local worktree, branch,
destination-tracking ref, remote URL, ancestry, and path policy. It also reads
canonical source provenance, its pinned receipt, and the corresponding local
source ref when those local records exist. Fresh, stale, unavailable, and the
next safe action are therefore reported from real local facts instead of an
unconditional placeholder.

Status never fetches, imports, acquires a mutation lock, moves a ref, changes
the index or worktree, writes or advances ledger history, dispatches delivery
work, or calls a provider. All local Git reads are time- and output-bounded.

The optional graph lane contributes only a read-only experimental status field:
its enabled flag, pinned adapter receipt, fresh/stale/unavailable/invalid/
blocked/failed state, reason, and `inspect-source-directly` fallback. Status
never runs a graph command, acquires a graph lock, creates a cache, or installs
a dependency. A graph is never delivery authority.
