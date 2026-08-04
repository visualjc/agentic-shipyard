# Promotion

`shipyard-promote` evaluates a current exact-SHA review, acceptance evidence,
binding, topology, actor, path policy, and operation lock through the trusted
Shipyard operation. These facts are revalidated at the operation boundary;
status output cannot be reused as authority.

Drift, stale evidence, or an incomplete gate returns a deterministic blocker.
Promotion never merges or finalizes work. Next safe action: use
`shipyard-promote` only for the exact candidate returned by Shipyard.
