---
issue: 2
title: Establish core package, binding, setup, status, and help
analyzed: 2026-08-04T02:59:05Z
estimated_hours: 44
parallelization_factor: 1.7
status: completed
---

# Parallel Work Analysis: Issue #2

## Overview

Issue #2 establishes the fail-closed foundation every later Shipyard slice
imports. The product worktree deliberately contains only `README.md` and
`.gitignore`; package conventions and public interfaces therefore need one
explicit owner before command wiring begins. The first two streams can create
non-overlapping source trees in parallel. The command surface is deliberately
queued: it consumes both the public contracts and the binding/lock APIs, and
is the sole owner of user-facing setup guidance.

This analysis is a planning record only. No implementation, acceptance, or
review status is implied by it.

## Parallel Streams

### Stream A: Package and pure core contracts

**Scope**: Establish the Node 22 TypeScript ESM package, public API boundary,
versioned data schemas, lifecycle/status projection extension contracts, and
unit tests for pure validation/state behavior.

**Files**:

- `package.json` (exclusive owner)
- `tsconfig.json` (exclusive owner)
- `src/index.ts` (exclusive owner of public exports)
- `src/contracts/**`
- `src/status/**`
- `test/contracts/**`
- `test/status/**`

**Can Start**: immediately.

**Estimated Hours**: 14–16.

**Dependencies**: none. Stream A publishes stable import paths and typed
interfaces before Stream C begins. It must not import Stream B implementation
modules; it defines contracts that Stream B implements.

**Verification Responsibility**: Run typecheck and Node built-in unit tests
for contracts/status. Verify the package is ESM and exports only deliberate
public interfaces. Supply Stream C with the public export inventory.

### Stream B: Binding, classification, and mutation lock core

**Scope**: Implement Git-common-directory binding identity, complete-topology
and remote validation, one-owner path classification, and short repository
mutation locking behind injected filesystem/Git/process adapters. Cover the
fail-closed and stale-recovery cases in disposable local Git integration tests.

**Files**:

- `src/binding/**`
- `src/policy/**`
- `src/locking/**`
- `src/adapters/{filesystem,git,process}.ts`
- `test/binding/**`
- `test/policy/**`
- `test/locking/**`
- `test/helpers/**`

**Can Start**: immediately.

**Estimated Hours**: 16–18.

**Dependencies**: Stream A's contracts are the required integration boundary,
but Stream B can build its isolated modules/tests immediately against the
documented contract shapes. It must not modify `package.json`, `tsconfig.json`,
`src/index.ts`, `src/contracts/**`, or `src/status/**`. Before its first
integration commit, it rebases/reconciles only with Stream A's public contract
commit; conflicts are reported rather than auto-resolved.

**Verification Responsibility**: Disposable-Git tests prove main-clone and
linked-worktree common-directory equivalence, and table-driven tests prove
missing/partial/duplicate/stale/remote-mismatched binding rejection,
unclassified/conflicting path rejection, and live/stale lock behavior with
process/host validation.

### Stream C: Setup, read-only CLI, Codex skills, and focused docs

**Scope**: Wire `shipyard`, `shipyard-setup`, `shipyard-status`, and
`shipyard-help`; create the project/user Codex skill layout and focused
operation references; translate core failures into deterministic setup/rebind
guidance; and prove that status/help are read-only and identify the next safe
action.

**Files**:

- `src/cli/**`
- `src/commands/{setup,status,help}.ts`
- `bin/**`
- `skills/shipyard/**`
- `skills/shipyard-setup/**`
- `skills/shipyard-status/**`
- `skills/shipyard-help/**`
- `docs/{setup,status,help,metadata-ownership}.md`
- `test/cli/**`
- `test/integration/setup-status-help/**`
- `README.md`

**Can Start**: only after Stream A's public exports and Stream B's binding/
policy/lock API are committed and reconciled.

**Estimated Hours**: 14–16.

**Dependencies**: Stream A and Stream B. Stream C is the only stream permitted
to convert internal errors to CLI guidance and to own command/skill discovery.
It does not modify shared package/config/export files.

**Verification Responsibility**: Run CLI integration tests in disposable
repositories. Assert setup validates (but never provisions or rewrites
remotes), rebind is explicit, bindings work from linked worktrees, status/help
perform no writes and acquire no mutation lock, and each focused skill/reference
set points to a next safe command.

## Acceptance and Definition-of-Done Mapping

| Requirement | Implementing stream | Verification owner and evidence |
| --- | --- | --- |
| Issue AC: TypeScript ESM package; `shipyard` CLI; Codex project/user skill layout | A (package/exports), C (CLI/skills) | C: package/discovery and CLI smoke tests |
| Issue AC: versioned schemas for profiles, topologies, path policy, operations, lifecycle | A | A: schema unit tests and compatibility/version fixtures |
| Issue AC: shared one-owner classifier, reusable by later slices | B | B: table-driven product/development-record/generated/destination/context/scratch, unclassified, and conflict tests |
| Issue AC: repository mutation lock and safe stale recovery | B | B: process/host ownership unit tests with fake adapters |
| Issue AC: extensible status projection fields | A | A: projection composition and extension tests |
| Issue AC: setup validates complete topology; no provisioning/remote rewrite; explicit rebind | C using B | C: disposable-Git setup integration tests plus adapter call assertions |
| Issue AC / PRD AC-002: common-directory binding resolves identically in linked worktrees | B, surfaced by C | B: disposable linked-worktree tests; C: CLI regression test |
| Issue AC / PRD AC-001: missing/partial/duplicate/stale/remote mismatch stops with guidance | B detects; C presents | B: guard matrix; C: error-to-guidance integration matrix |
| Issue AC / PRD AC-023 foundation: read-only status/help report next safe action | C using A | C: no-write/no-lock tests and focused-reference discovery test |
| DoD: typed public interfaces | A | A: `tsc --noEmit` and public-import compilation fixture |
| DoD: unit and disposable Git integration tests | A/B/C by owned scope | C: aggregate command and targeted-suite report |
| DoD: focused setup/status/help documentation | C | C: link/reference smoke checks and manual command examples |
| DoD: exact product SHA and verifier in acceptance evidence | C (record assembly), independent reviewer later | C: evidence template contains SHA/verifier/time; not marked pass here |
| DoD: no unresolved independent-review finding | Independent reviewer after integration | Separate reviewer evaluates exact integrated SHA; no stream self-approves |

The explicit evidence targets are PRD AC-001, AC-002, AC-021, and the
foundational portion of AC-023. They are implementation-test targets for this
issue, not release-wide claims that all PRD acceptance criteria have passed.

## Coordination Points

### Shared files and owners

| Shared surface | Sole owner | Consumer rule |
| --- | --- | --- |
| `package.json`, `tsconfig.json` | Stream A | A creates scripts/dependencies; no other stream edits them. |
| `src/index.ts` and all public exports | Stream A | B/C request additions through A; C imports public API only. |
| `src/contracts/**` | Stream A | B implements against these interfaces; changes require A approval. |
| `README.md` | Stream C | A/B document only in their stream records until C integrates. |
| CLI/skills/docs | Stream C | A/B expose errors/data, never print CLI guidance. |

### Sequential requirements

1. Stream A commits package/config/public contracts and communicates the
   export inventory.
2. Stream B reconciles its adapter/core implementation to those contracts and
   commits the binding/policy/lock API.
3. Stream C starts only after both commits are available; it owns integration
   wiring, user-facing errors, skills, docs, and command tests.
4. A separate reviewer receives the final exact integrated SHA, tests, and
   issue intent; it does not inherit implementer context.

## Conflict Risk Assessment

Risk is moderate until the contracts settle, and low thereafter. The primary
risk is cross-stream changes to package setup or export names. Exclusive
ownership prevents file races; Stream C's delayed start prevents speculative
CLI coupling. No stream may alter another stream's file scope without a
recorded handoff in its update file.

## Parallelization Strategy

Launch Streams A and B now. Treat Stream C as queued rather than assigning it
speculative scaffolding. This retains useful concurrency in the core while
preserving one authority for the package/config/public surface and avoiding
rework in the CLI.

## Expected Timeline

- With Streams A and B parallel, then C: 30–34 hours wall time before review.
- Without parallelism: 44–50 hours before review.
- Expected efficiency gain: approximately 30%.
