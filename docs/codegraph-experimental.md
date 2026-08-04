# CodeGraph (experimental)

CodeGraph is disabled by default and requires explicit local-only approval and
the reviewed `codegraph@1.5.0` receipt at
`49c11fc2e0c02170742be8411e66a31af611f4b7`. Before any init, restore, or
refresh the adapter proves the selected Node runtime can create an in-memory
SQLite FTS5 table, disables telemetry, and establishes/verifies a machine-local
`info/exclude` entry for `.codegraph/`. The cache must not be tracked.

Copying an exact-main `.codegraph` cache is an empirical observation at this
reviewed pin, not an upstream-guaranteed behavior. It remains private to each
canonical worktree. Any failed probe, exclusion, command, lock, or freshness
check falls back to direct source inspection. No installer, MCP setup, or
provider transmission is permitted.

The production lane uses only canonical absolute Git/Node/CodeGraph paths and
bounded local children. It verifies `.codegraph/` exclusion and tracked state
both before and after indexing while one sibling external lock is held through
descriptor persistence. The executable provenance sidecar and live-Git baseline
authorization rules are the same as Graphify; structural baseline DTOs cannot
authorize a copy.
