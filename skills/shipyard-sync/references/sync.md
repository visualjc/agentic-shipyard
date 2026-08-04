# Sync reference

Run `shipyard-sync` for a clean fast-forward from bound destination `main`.
Run `shipyard-sync --source-ref REF` only when REF is an exact branch, tag, or
full ref. The command verifies `SHIPYARD_GIT_TOKEN` against the bound GitHub actor and uses it only in an isolated staging child process,
records provenance in isolated ledger history, and blocks on dirt, divergence,
remote drift, unsafe path ownership, stale provenance, or lock uncertainty.

Source refs under `refs/shipyard/source/` are local-only and must never appear
in product publication refspecs.
