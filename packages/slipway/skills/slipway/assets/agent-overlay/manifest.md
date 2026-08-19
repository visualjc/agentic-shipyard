# Slipway private agent overlay manifest

- Format: `slipway-agent-overlay/v1`
- Purpose: private Repo-B policy materialized from the ledger only
- Canonical ledger directory: `.slipway/agent-overlay/`
- Version: Git tree object ID of `HEAD:.slipway/agent-overlay`

## Required canonical sources

- `manifest.md`
- `AGENTS.local.md`
- `CLAUDE.local.md`

Each required source must be present exactly once as a regular, non-empty file
relative to the overlay root, with no `.`/`..` traversal. `CLAUDE.local.md`
must contain exactly `@AGENTS.local.md` followed by one LF.

## Materialized path allowlist

- `AGENTS.local.md`
- `CLAUDE.local.md`
- `docs/agents/**`

No other path may be materialized. `docs/agents/**` is optional; when present,
every resolved file must be regular, relative to the overlay root, non-empty,
and free of `.`/`..` traversal. `docs/agents/**` is an allowlisted path
pattern, not itself a file.
`manifest.md` is ledger metadata, not a materialized Repo-B file.
Absence, duplication, invalid mode, an empty required source, or adapter
mismatch makes the current or historical canonical tree invalid before
hydration or lane work.
