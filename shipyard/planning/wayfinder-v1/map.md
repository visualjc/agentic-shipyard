# Wayfinder map: Shipyard v1 product definition

Updated: 2026-08-03

## Destination

Reach a CCPM-ready Shipyard product definition: settled product policy is
durable, high-risk mechanics have empirical answers, and the supported v1
boundary is clear enough to synthesize acceptance criteria, Definition of Done,
technical epics, and vertical implementation tasks without reopening resolved
design questions.

## Notes

- This map uses the local-Markdown tracker. Planning is local-only.
- Read [`../../PREMISE.md`](../../PREMISE.md) for the product premise.
- Use Wayfinder for decisions and prototypes only; do not implement Shipyard
  while working this map.
- Use `/research` for research tickets and `/prototype` for prototype tickets.
- The shared workflow is named `reviewed-delivery`.
- Preserve the predecessor package at `../../../justgames-agentic-workflow/`
  as historical source material until migration is separately planned.
- Do not provision real JustGames mirrors, change remotes, install graph tools
  against company code, create external repositories, or mutate GitHub unless a
  frontier ticket explicitly reaches that action and the user initiates it.
- During disposable GitHub fixture work, use only `visualjc` and
  `NativeInteractive`. Do not use or associate `justgamesjim`, SentientDogs, a
  Just Games email identity, or any other Just Games resource until Jim
  explicitly lifts this temporary boundary.
- Research and prototype outputs should be linked from their ticket rather than
  pasted into this map.

## Decisions so far

- [Define Shipyard's product promise](issues/01-define-product-promise.md) — Shipyard separates rich agent scaffolding from the destination artifacts a team agrees to maintain.
- [Separate the generic product from deployment policy](issues/02-separate-product-and-deployment-policy.md) — The future-open-source engine lives in `shipyard`; real profiles and private policy live in sibling `shipyard-config`.
- [Use one reviewed-delivery workflow](issues/03-use-one-reviewed-delivery-workflow.md) — All profiles share one evidence-backed workflow with host-specific execution adapters and progressive skill loading.
- [Make setup and identity fail closed](issues/04-make-setup-and-identity-fail-closed.md) — Explicit global profiles, complete bindings, scoped GitHub actors, and short mutation locks define authority.
- [Support staged-pair and single-repository topologies](issues/05-support-two-topologies.md) — Clean mirrored baselines and topology-specific promotion support mixed-adoption and AI-native repositories.
- [Classify metadata and context by ownership](issues/06-classify-metadata-and-context.md) — Shared or contained metadata follows explicit path ownership; ambiguous paths and same-path dual ownership block.
- [Keep an independent development ledger](issues/07-keep-an-independent-ledger.md) — A parallel ledger branch, exact-SHA tag, and pinned role-aware context envelope preserve durable records.
- [Use baseline plus per-worktree graph state](issues/08-use-worktree-specific-graph-state.md) — Worktrees seed from reusable baselines but never share a mutable graph across divergent code states.
- [Keep synchronization narrow and explicit](issues/09-keep-synchronization-narrow.md) — Sync fast-forwards clean baselines and imports explicitly named company refs as local read-only sources.
- [Promote reviewed payloads without fork PRs](issues/10-promote-reviewed-payloads.md) — Staged pairs use sanitized company branches and append-only revisions; single repositories certify their existing PR.
- [Define Shipyard's toolchain ownership model](issues/20-define-toolchain-ownership.md) — Shipyard owns its orchestration and adapters; external systems are pinned and verified rather than casually vendored, and user-owned `yolo-*` behavior migrates into Shipyard instead of remaining a parallel family.
- [Research graph-tool constraints](issues/11-research-graph-tool-constraints.md) — Shipyard owns a tool-independent freshness contract; Graphify is the first experimental adapter, CodeGraph remains per-worktree and experimental, and Understand Anything feature-worktree authority is deferred.
- [Research the development-toolchain contract](issues/21-research-development-toolchain-contract.md) — Exact reviewed Matt-skills, CCPM, and Pstack dependencies are capability-pinned and verified; Shipyard intercepts their writes, merging, metadata, and evidence boundaries.
- [Prototype the local Shipyard lifecycle](issues/12-prototype-local-lifecycle.md) — A 29-assertion synthetic Git lab validates the staged-pair history model and fail-closed guards while narrowing production work around Git-native payloads, source-ref policy, stale locks, and resumable cleanup.
- [Prototype ledger checkpointing and context resolution](issues/13-prototype-ledger-and-context-resolution.md) — A deterministic common-dir resolver, explicit ambiguity handling, pinned role envelopes, and optimistic ledger transactions work without a persistent broker.
- [Prototype worktree graph freshness](issues/14-prototype-worktree-graph-freshness.md) — Graphify and CodeGraph pass isolated exact-source synthetic seeding behind strict experimental wrappers; Understand Anything authoritative feature state remains deferred.
- [Choose disposable GitHub fixtures](issues/16-choose-disposable-github-fixtures.md) — The private staged pair is `visualjc/shipyard-fixture-staged` to `NativeInteractive/shipyard-fixture-staged`, using only the scoped `visualjc` actor; all Just Games association and multi-account testing are deferred.
- [Prototype host-specific context handoff](issues/15-prototype-host-context-handoff.md) — Explicit role-limited envelopes, stale-SHA rejection, and reviewer isolation pass through separate ephemeral Codex processes; live Claude/CCPM and Cursor/Pstack dispatch are deferred until intentional Just Games validation.
- [Provision disposable GitHub fixtures](issues/17-provision-disposable-github-fixtures.md) — The exact private VisualJC/NativeInteractive staged pair was provisioned with a command-scoped `visualjc` actor and retained for inspection; no Just Games identity or resource was used.
- [Prototype GitHub identity and pull-request lifecycle](issues/18-prototype-github-identity-and-pr-lifecycle.md) — A real development issue/PR, two exact-SHA Codex reviews, append-only destination-owned PR revision, exact-head merge, resumable finalization, baseline sync, metadata containment, and close-without-merge cleanup all passed; inherited Git credentials and GraphQL mutation compatibility require stricter adapters.
- [Select the evidence-backed v1 boundary](issues/19-select-the-evidence-backed-v1-boundary.md) — Shipyard v1 supports Codex, GitHub, staged-pair and single-repository reviewed delivery, exact-SHA evidence, resumable lifecycle operations, and metadata containment; other live hosts, multi-profile identity routing, protected-branch variants, and authoritative Understand Anything graphs are deferred.

## Current frontier

The Wayfinder map has reached its destination. The next step is CCPM PRD
synthesis from the premise, resolved tickets, research, and prototype evidence.
That synthesis is now available at
[`./.claude/prds/shipyard-v1.md`](.claude/prds/shipyard-v1.md).

## Not yet specified

No unresolved product decision blocks the v1 PRD. Deferred integrations and
post-v1 roadmap choices are recorded in ticket 19 and must not leak into v1
acceptance promises.

## Out of scope

- Production Shipyard implementation, installation, or migration.
- Creating `~/projects/justgames-jim/`, creating missing GitHub mirrors, changing
  repository remotes, or onboarding `just-jim`.
- Running a real JustGames delivery or changing any SentientDogs resource.
- Synthesizing the CCPM PRD, technical epic, or implementation tickets; those
  begin only after this map reaches its destination.
- Resuming the predecessor workflow's deferred bug-policy grilling or hotfix
  design.
- Publishing an open-source repository, choosing a license, or building the
  future `shipyard-ledger-understand` command.
