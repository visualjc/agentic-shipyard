# Graphify (experimental)

Graphify is disabled by default and may run only with an explicit local-only
approved profile and the reviewed receipt `graphify@0.9.32` at
`00efd6e7969837ae4a9f11d8d504dcd3b20b09df`. The adapter uses code-only mode,
disables query logging, sets both absolute `GRAPHIFY_OUT` and matching `--out`,
and surrounds every seed or refresh with a bounded whole-product-tree
observation (excluding root Git metadata). The post-operation audit detects
arbitrary created, removed, or modified paths, not only known Graphify names.
It removes only paths that were absent before the invocation and whose content
and filesystem identity remain unchanged through cleanup, then resnapshots the
tree to prove restoration. Pre-existing paths, and new paths whose identity or
content changes again before cleanup, are never deleted as leaks. Any detected
leak fails the operation even after successful cleanup; ambiguous changes or
unproved cleanup require direct inspection. A
missing tool, failed command, stale source, or failed relocation audit likewise
means inspect source directly; no code, query, image, or document may be sent
to a provider.

Production execution is available only through the controlled graph-lane
factory. It pins an absolute executable and its reviewed SHA-256 in the profile,
rehashes the actual executable before `--version` and every operation, bounds
child time/output, and terminates the complete child process group on either
limit. Writable adjacent sidecars are not trusted as provenance. Shipyard never
installs the executable.

One external transaction lock is held through content hashing and descriptor
persistence. The descriptor binds the reviewed executable digest and a
deterministic digest of the generated cache bytes. Baseline copying additionally
requires an opaque authorization resolved from a live, distinct, clean `main`
Git worktree and the exact Shipyard-owned descriptor/cache; caller-labelled
descriptors, cache paths, and baseline objects have no authority.
