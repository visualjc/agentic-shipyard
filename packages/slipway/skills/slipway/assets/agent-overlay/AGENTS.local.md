# Private Repo-B agent overlay

This policy belongs only to the private agentic repository/worktree. It is
materialized from the Slipway ledger and must never be committed, included in
agentic PR cargo, promoted, or required by the delivery repository.

## Private policy boundary

Keep project-specific agent configuration and supporting guidance in this
overlay: this file and `docs/agents/**`. Do not put private policy in tracked
`AGENTS.md` or `CLAUDE.md`. Tracked instruction files may retain ordinary
team-facing project guidance plus the generic local extension point and Claude
adapter approved during setup; they must not require private tools or skills.

## Matt setup redirection

`setup-matt-pocock-skills` normally prefers tracked `CLAUDE.md`, then
`AGENTS.md`. Slipway must intercept that destination. It may perform discovery,
ask its questions, and generate a confirmed draft, but its instruction additions
must be persisted through the ledger overlay: add shared private instructions
here and supporting material under `docs/agents/**`. Keep `CLAUDE.local.md` as
the one-line `@AGENTS.local.md` adapter. Do not write Matt output to a tracked
file or a per-run metadata commit.

This is defense in depth; Slipway must still enforce interception, hydration,
byte verification, and cargo rejection.
