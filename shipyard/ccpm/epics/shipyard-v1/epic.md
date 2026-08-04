---
name: shipyard-v1
status: backlog
created: 2026-08-03T23:28:55Z
updated: 2026-08-04T13:34:34Z
progress: 60%
prd: shipyard/ccpm/prds/shipyard-v1.md
github: https://github.com/visualjc/agentic-shipyard/issues/1
storage_root: shipyard/ccpm
---

# Epic: shipyard-v1

## Overview

Build the first usable Shipyard release: a Codex-supported, GitHub-backed
reviewed-delivery workflow that lets an agentic development repository retain
rich planning and evidence while delivering only explicitly allowed product
cargo to a destination repository.

V1 supports both staged-pair and single-repository topologies. It must enforce
exact repository binding, command-scoped actors, one-owner metadata paths,
exact-SHA acceptance and independent review, normal destination-owned pull
requests, resumable finalization, and development-only ledger retention.

## Architecture Decisions

### Runtime and package shape

- Use a single TypeScript ESM package targeting Node 22 or newer.
- Expose a `shipyard` CLI plus Agent Skill directories for the eight public
  commands.
- Keep core state transitions, schemas, evidence decisions, and path policy as
  pure modules with no GitHub or filesystem side effects.
- Place Git, GitHub, Codex, dependency, and graph integrations behind narrow
  adapters.
- Use Node's built-in test runner for the core unless implementation evidence
  justifies a different runner.

### State ownership

- Private profiles and repository allowlists live outside the generic product.
- Machine bindings are keyed by Git common directory.
- Durable delivery state lives on the parallel `shipyard-ledger` branch.
- Rebuildable graphs, locks, credentials, and worktree registrations remain
  machine-local.
- Every external mutation is checkpointed for exact-state resume.

### Provider and host boundary

- GitHub is the only v1 tracker/PR provider.
- GitHub API mutations use a verified command-scoped actor; authenticated Git
  disables inherited credential helpers.
- Prefer GitHub REST endpoints for deterministic writes.
- Codex is the only supported live host. Workers receive explicit pinned
  envelopes; reviewers run in separate ephemeral processes.
- CCPM and Matt skills are exact-pinned external dependencies. Shipyard owns
  their authority boundaries and never trusts raw issue/merge behavior.

### Delivery topology

- Staged pairs develop and review in the development repository, then append
  sanitized commits to a normal destination-owned PR.
- Single repositories certify their existing PR and never create a second PR.
- Only the destination's human/team process merges.
- Finalization archives evidence, synchronizes authoritative `main`, and cleans
  delivery branches without merging the staged development PR.

## Technical Approach

### Core modules

- `binding`: profile/topology resolution from a Git common directory.
- `policy`: actor, repository, path ownership, metadata, and operation rules.
- `delivery`: lifecycle state machine and resumable checkpoints.
- `evidence`: acceptance/Definition of Done schemas and exact-SHA freshness.
- `context`: ledger resolver and role-limited envelope builder.
- `payload`: Git-native tree comparison and sanitized delta construction.

### Adapters

- local Git and worktree operations;
- GitHub REST issue/PR/ref operations and scoped credentials;
- Codex worker/reviewer dispatch;
- exact-pinned dependency verification;
- optional experimental Graphify and CodeGraph freshness adapters.

### Public interface

The CLI and Agent Skills expose `shipyard`, `shipyard-setup`,
`shipyard-status`, `shipyard-review`, `shipyard-sync`, `shipyard-promote`,
`shipyard-finalize`, and `shipyard-help`. Each skill loads only its focused
reference documents and shares the same core policy engine.

## Implementation Strategy

1. Establish schemas, binding, and fail-closed read-only status first.
2. Add the ledger/context boundary before any provider mutation.
3. Add scoped GitHub issue authority and narrow synchronization.
4. Add exact-SHA acceptance and isolated review.
5. Implement topology-specific promotion/finalization behind the shared state
   machine.
6. Integrate the opinionated planning/orchestration surface.
7. Add optional graphs only after core correctness.
8. Close with interruption recovery, security checks, private synthetic
   provider evidence, and exact-SHA release acceptance.

## Task Breakdown Preview

1. Bootstrap the package, schemas, binding, setup, status, and help surface.
2. Implement the delivery workspace, ledger checkpointing, and context envelopes.
3. Implement scoped GitHub actor and development issue/PR authority.
4. Implement clean baseline and named source-ref synchronization.
5. Implement exact-SHA acceptance and independent Codex review.
6. Deliver the staged-pair promotion, revision, and finalization path.
7. Deliver single-repository certification and finalization.
8. Integrate planning lanes, dependency verification, and public orchestration.
9. Add experimental Graphify and CodeGraph adapters.
10. Harden recovery/security and prove the release end to end.

## Dependencies

- Task 001 is the shared foundation.
- Tasks 002 and 003 can proceed in parallel after 001.
- Task 004 depends on scoped GitHub authority.
- Task 005 depends on ledger/context and GitHub development tracking.
- Task 006 depends on the evidence gate and provider adapters; task 007 then
  reuses its shared topology dispatcher and manifests.
- Task 009 can proceed independently after core binding and ledger contracts.
- Task 008 integrates completed topology adapters.
- Task 010 is the release gate after all functional slices.

## Success Criteria (Technical)

- All PRD acceptance criteria AC-001 through AC-023 are evidenced against one
  exact release-candidate SHA.
- Local integration suites prove both topologies and all fail-closed guards.
- A private synthetic GitHub run proves scoped actors, normal destination PRs,
  append-only revision, exact-head merge verification, resumability, and zero
  metadata leakage.
- Codex role-envelope probes prove stale rejection and reviewer isolation.
- No public command can mutate through an ambiguous or unverified binding.

## Estimated Effort

- Ten implementation tasks.
- Approximately 260–340 engineering hours including tests, documentation,
  security review, and provider validation.
- Parallel work is available across ledger/provider, graph, and topology slices
  after the foundational schemas stabilize.

## Tasks Created

- [x] 2.md - Establish core package, binding, setup, status, and help (parallel: false)
- [x] 3.md - Deliver workspace, ledger checkpointing, and context envelopes (parallel: true)
- [ ] 4.md - Deliver scoped GitHub tracking authority (parallel: true)
- [x] 5.md - Deliver safe baseline and source-ref synchronization (parallel: true)
- [x] 6.md - Deliver exact-SHA acceptance and Codex review (parallel: true)
- [x] 7.md - Deliver staged-pair promotion and finalization (parallel: false)
- [ ] 8.md - Deliver single-repository certification and finalization (parallel: false)
- [ ] 9.md - Integrate planning lanes and public orchestration (parallel: false)
- [x] 10.md - Add experimental graph freshness adapters (parallel: true)
- [ ] 11.md - Harden recovery and prove release readiness (parallel: false)

Total tasks: 10  
Parallel tasks: 5  
Sequential tasks: 5  
Estimated total effort: 260–340 hours
