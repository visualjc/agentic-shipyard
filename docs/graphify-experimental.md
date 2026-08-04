# Graphify (experimental)

Graphify is disabled by default and may run only with an explicit local-only
approved profile and the reviewed receipt `graphify@0.9.32` at
`00efd6e7969837ae4a9f11d8d504dcd3b20b09df`. The adapter uses code-only mode,
disables query logging, sets both absolute `GRAPHIFY_OUT` and matching `--out`,
and surrounds every seed or refresh with a bounded whole-product-tree
observation (excluding root Git metadata). The post-operation audit detects
arbitrary created, removed, or modified paths, not only known Graphify names.
Cleanup authority is limited to the exact top-level reviewed Graphify leak
roots `graphify-out` and `.graphify` when the root was absent before the
invocation. Their invocation-created contents are removed only while filesystem
identity and content continue to match the post-operation observation.
Pre-existing reviewed roots and arbitrary additions anywhere else are
ownership-ambiguous, are preserved, and fail non-authoritatively for direct
inspection. Shipyard reports the product tree as restored only when a final
whole-tree observation exactly matches the before observation; otherwise an
unknown addition or other ambiguous change remains a failed operation. Any
detected leak fails the operation even after successful cleanup. A
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
