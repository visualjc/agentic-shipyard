# ADR-0005: Slipway-owned private context modules

## Status

Accepted.

## Context

The delivery repository must remain usable by teammates who do not install the
agentic repository's private skills or tools. It must not even require a
tracked extension point for them. Host-native instruction files either leak
that extension contract or bind the design to one agent host.

Slipway still needs durable project-specific instructions, tool metadata, and
setup results that can augment coordinators, workers, and reviewers.

## Decision

Keep one canonical private context registry at `.slipway/context/` on the
parallel ledger branch. Version it with that directory's Git tree object ID.
`manifest.yaml` declares non-executable Markdown modules with an ID,
entrypoint, required/optional status, applicable operations, capability
requirements, repository markers, and propagation targets.

Slipway is the portable bootstrap. It validates and optionally caches the
registry under ignored `.slipway-local/context/`, selects modules for the
operation, explicitly reads coordinator context, and passes exact selected
context to workers and reviewers. Arbitrary sessions that bypass Slipway are
not guaranteed to receive private context.

Context precedence is fixed: Slipway safety and authorization, project/cargo
configuration, selected private modules, then lane/task instructions within
the higher-level boundaries. Modules may augment but never weaken safety,
cargo, repository identity, exact-SHA review, or external-write gates.

Setup never creates or changes tracked `AGENTS.md`, `CLAUDE.md`, or another
public instruction merely to bootstrap Slipway. Matt setup drafts are persisted
inside the private `matt-skills` module. Tool guidance such as CodeGraph remains
optional and activates only when its marker and capability are present.

## Consequences

- Agentic and delivery tracked main trees can remain identical.
- The delivery repository has zero awareness of the private context system.
- Private context is durable, versioned, selective, and available to delegated
  work without host instruction discovery.
- Direct non-Slipway sessions may not receive the augmentation.
- Context/cache paths stay excluded from cargo; context templates inside the
  reviewed Slipway package remain ordinary product source.
- Executable plugins and hooks remain out of scope.
