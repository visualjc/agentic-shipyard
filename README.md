# Agentic Shipyard

This repository contains **Slipway**, a skills-first coordinator that delivers
reviewed product-only commits from an agentic repository into a clean
team-facing repository.

Slipway's canonical source lives under [`packages/slipway/`](packages/slipway/).
It is a Markdown/YAML skill suite with no runtime service. Start with the
[product specification](packages/slipway/docs/spec.md),
[architecture](packages/slipway/docs/architecture.md), or
[installation guide](packages/slipway/distribution/README.md).

## Repository boundary

An agentic repository may contain plans, prototypes, private skill policy, and
durable ledger state. The delivery repository receives only exact reviewed
product cargo. Slipway keeps private project-wide agent instructions in a
ledger-backed ignored overlay, so shared Git history does not require Matt
skills or any other personal agent toolset. This README is product
documentation and remains valid in either repository.

Shipyard remains the separate policy-engine product used for comparison;
Slipway is not a renamed or reduced Shipyard implementation.
