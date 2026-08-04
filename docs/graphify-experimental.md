# Graphify (experimental)

Graphify is disabled by default and may run only with an explicit local-only
approved profile and the reviewed receipt `graphify@0.9.32` at
`00efd6e7969837ae4a9f11d8d504dcd3b20b09df`. The adapter uses code-only mode,
disables query logging, sets both absolute `GRAPHIFY_OUT` and matching `--out`,
and verifies after every seed or refresh that no `graphify-out/**` output leaked
under the product worktree. A missing tool, failed command, stale source, or
failed relocation audit means inspect source directly; no code, query, image,
or document may be sent to a provider.

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
