# Select the evidence-backed v1 boundary

Type: grilling  
Status: resolved  
Blocked by: 11, 12, 13, 14, 15, 18, 21

## Question

Given the research and prototype evidence, which promised behaviors belong in
Shipyard v1, which remain experimental behind explicit profile flags, and which
move to the deferred roadmap before the CCPM PRD is synthesized?

Resolve each uncertain adapter or mechanism against observed correctness,
safety, privacy, performance, maintenance burden, and cross-host portability.
The result must leave no unresolved product decision required to write stable
acceptance criteria and Definition of Done.

## Comments

- This is the final Wayfinder decision before CCPM PRD synthesis.

## Answer

Shipyard v1 is a Codex-supported, GitHub-backed `reviewed-delivery` product with
two configured topologies and strict separation between product cargo and
agentic scaffolding.

### Required v1 behavior

- Generic engine and private deployment profiles remain separate packages.
- `shipyard-setup` binds a complete topology and all operational commands fail
  closed on missing, ambiguous, stale, or policy-incompatible bindings.
- `reviewed-delivery` classifies work, creates a requirements/acceptance
  contract, executes in a worktree, opens a development PR, audits an exact SHA,
  runs independent Codex review, invalidates evidence after every SHA change,
  promotes, waits for destination merge, and finalizes resumably.
- `staged-pair` is fully supported with a development-only issue/PR, normal
  destination-owned PR, sanitized append-only revisions, no fork PR, no force
  push, destination human merge, clean-baseline synchronization, close-without-
  merge development cleanup, and development-only ledger/tag retention.
- `single-repository` remains a required v1 topology. It certifies the existing
  PR rather than creating a second PR. Its simpler path must pass dedicated
  implementation acceptance tests before release even though this prototype
  used the staged pair.
- `development-only` and explicit `shared` metadata policies use one-owner path
  classification; unclassified or dual-owned paths block.
- Parallel ledger records, exact-SHA annotated tags, pinned role envelopes,
  machine-local caches, short mutation locks, and resumable checkpoints are
  core.
- Sync only fast-forwards clean baselines or imports an explicitly named
  read-only source ref. Promotion and finalization are distinct explicit
  mutations.
- GitHub operations use an explicitly verified command-scoped actor without
  changing global `gh` configuration. Git operations independently disable
  inherited credential helpers and use ephemeral scoped credentials.
- GitHub REST endpoints are the deterministic mutation interface where the CLI
  has compatibility-sensitive GraphQL behavior.
- Codex explicit-envelope dispatch is the only supported live host adapter.
  Separate ephemeral reviewer execution is required.
- Matt skills and the maintained CCPM skill-layout fork remain pinned external
  dependencies. Shipyard may use CCPM for PRD/task structure, but v1 correctness
  does not depend on implicit CCPM child-agent context propagation or raw CCPM
  merge/issue authority.
- Acceptance criteria and Definition of Done items have stable IDs, exact-SHA
  evidence, verifier identity, and explicit pass/block/not-applicable state.
  Generated task completion never substitutes for acceptance evidence.

### Experimental, opt-in v1 behavior

- Graphify and CodeGraph adapters may ship behind explicit experimental profile
  flags. They must obey the proven exact-source, per-worktree freshness contract
  and fall back to direct source inspection when unavailable or stale.
- CodeGraph additionally requires the verified Node/FTS5 runtime and must not
  claim upstream-supported cache seeding.
- Compatibility aliases for predecessor `yolo-*` or `justgames-*` skills may
  exist only after the corresponding Shipyard command validates its binding and
  behavior; they are not required for the initial release.

### Deferred roadmap

- live Claude Code/CCPM and Cursor/Pstack execution;
- implicit child-agent context inheritance;
- multi-profile/concurrent GitHub account routing beyond one explicitly scoped
  actor;
- official approval-dismissal semantics, protected-branch variants, and
  distinct development/destination actors;
- authoritative Understand Anything feature-worktree graphs;
- non-GitHub tracker adapters;
- automated production-repository provisioning or remote rewriting;
- Just Games onboarding, mirror creation, or predecessor-skill retirement;
- `shipyard-ledger-understand` and open-source publication/licensing work.

This boundary leaves no product choice blocking acceptance criteria or
Definition of Done synthesis. Deferred integrations must not be described as v1
guarantees.
