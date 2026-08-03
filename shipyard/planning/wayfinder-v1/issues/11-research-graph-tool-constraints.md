# Research graph-tool constraints

Type: research  
Status: resolved

## Question

What officially supported storage, worktree, incremental-update, freshness,
privacy/provider, output-relocation, caching, licensing, and redistribution
behavior of CodeGraph, Graphify, and Understand Anything constrains Shipyard's
v1 adapter promises?

The answer must distinguish documented guarantees from inference, identify
version-sensitive behavior, and recommend which integrations can be core,
optional, experimental, or deferred. It must also define what may safely be
tested with proprietary code and what requires a synthetic/public fixture or
approved local model.

Known primary starting points:

- <https://github.com/colbymchenry/codegraph>
- <https://github.com/Graphify-Labs/graphify>
- <https://github.com/Egonex-AI/Understand-Anything>

## Comments

- This is on the initial frontier.
- Research was not launched while charting because this side conversation
  explicitly prohibits subagents.

## Answer

Shipyard v1 will define a tool-independent freshness and per-worktree cache
contract, but no graph product is universally required. Graphify is the first
optional experimental adapter because it supports relocated output and portable
relative-path caches. CodeGraph remains optional and per-worktree; upstream does
not guarantee baseline database seeding. Understand Anything is deferred as an
authoritative feature-worktree graph because it redirects to the main checkout
by default and lacks a documented external output-root option.

All first mechanics tests use synthetic repositories. Proprietary code requires
explicit approval and a reviewed local-only mode with telemetry or query logging
disabled.

Full evidence and the ticket-14 adapter contract are in
[`../research/graph-tool-constraints.md`](../research/graph-tool-constraints.md).
