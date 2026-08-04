# Sync reference

Run `shipyard-sync` for a clean fast-forward from bound destination `main`.
Run `shipyard-sync --source-ref REF` only when REF is an exact branch, tag, or
full ref. The command verifies `SHIPYARD_GIT_TOKEN` against the bound GitHub actor and uses it only in an isolated staging child process,
records provenance in isolated ledger history, and blocks on dirt, divergence,
remote drift, unsafe path ownership, stale provenance, or lock uncertainty.
If a durable source receipt reports that local ref creation failed, rerun the
same explicit source import; Shipyard will resume without replacing a different
immutable source ref or its last usable canonical record.

The command accepts only `--source-ref`, `--repo`, and `--home`, each at most
once, with no positional values. Treat unknown, misspelled, duplicate, empty,
or ambiguous arguments as a refusal before repository or credential access.

Source refs under `refs/shipyard/source/` are local-only and must never appear
in product publication refspecs.
