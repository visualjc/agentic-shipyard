# Slipway private agent overlay manifest

- Format: `slipway-agent-overlay/v1`
- Purpose: synthetic canonical overlay for dry-run contract validation
- Canonical ledger directory: `.slipway/agent-overlay/`
- Version: Git tree object ID of `HEAD:.slipway/agent-overlay`

## Materialized paths

- `AGENTS.local.md`
- `CLAUDE.local.md`
- `docs/agents/**`

No other path may be materialized. Every resolved file must be regular,
relative to the overlay root, non-empty, and free of `.`/`..` traversal;
`docs/agents/**` is an allowlisted path pattern, not itself a file.
`manifest.md` is ledger metadata, not a materialized Repo-B file.
