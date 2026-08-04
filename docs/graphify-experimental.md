# Graphify (experimental)

Graphify is disabled by default and may run only with an explicit local-only
approved profile and the reviewed receipt `graphify@0.9.32` at
`00efd6e7969837ae4a9f11d8d504dcd3b20b09df`. The adapter uses code-only mode,
disables query logging, sets both absolute `GRAPHIFY_OUT` and matching `--out`,
and verifies after every seed or refresh that no `graphify-out/**` output leaked
under the product worktree. A missing tool, failed command, stale source, or
failed relocation audit means inspect source directly; no code, query, image,
or document may be sent to a provider.
