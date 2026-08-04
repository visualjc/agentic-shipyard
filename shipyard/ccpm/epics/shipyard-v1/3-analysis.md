---
issue: 3
title: Deliver workspace, ledger checkpointing, and context envelopes
analyzed: 2026-08-03T00:00:00Z
estimated_hours: 32
parallelization_factor: 1.5
status: planned
---

# Parallel Work Analysis: Issue #3

## Grounding and boundary

This plan is based on the issue record, the Shipyard v1 PRD, epic, and product
premise, plus issue #2's accepted exact-SHA contract and execution records at
`bba2e5e083ea460deba92ffa686b986b8102067f`.  The requested
`.claude/ccpm/SKILL.md` is not present in this linked CCPM ledger; the task,
PRD, epic, and update records are the available pinned execution guidance.

The ledger/context prototypes establish the implementation constraints: use a
machine-local delivery registry keyed by common Git directory; create durable
records on an orphan `shipyard-ledger` ref; compare an expected ledger head
while holding a short lock; detect same-path conflict rather than merge it; and
read pinned records through `git show <ledger-sha>:<path>` without checking out
the ledger in a product worktree.

Issue #3 owns local workspace, ledger, resolver, and context behavior only.
It deliberately does **not** own actor selection, GitHub REST, `gh` account
state, authenticated Git credential transport, issue/PR discovery, or provider
status fields.  Those are issue #4's provider-authority slice.  No stream may
add GitHub-specific fields to a delivery record or mutate a remote provider.

## Parallel Streams

### Stream A: Delivery identity, local registry, and resolver

**Scope**: Define the versioned delivery/workspace records and narrow ports;
implement deterministic resolution from a bound worktree or explicit delivery
ID; and own machine-local registry validation.  Resolution must reject an
unbound/invalid registry, no active delivery, duplicate ID, worktree mismatch,
and genuine multiple-delivery ambiguity.  It returns immutable snapshots, not
mutable authority that callers may reuse across an operation.

**Files**:

- `src/delivery/types.ts`
- `src/delivery/errors.ts`
- `src/delivery/registry.ts`
- `src/delivery/resolver.ts`
- `test/delivery/registry.test.ts`
- `test/delivery/resolver.test.ts`

**Can Start**: immediately, against issue #2's `BindingService`, canonical
`Binding`, `GitAdapter.commonDirectory`, and filesystem port.  It does not
modify those issue #2-owned files.

**Estimated Hours**: 9–11.

**Verification Responsibility**: Table-driven unit tests prove explicit-ID
selection, linked-worktree/common-directory resolution, no-result/ambiguous
failure, invalid or duplicate registry rejection, and resolver recomputation.
Provide Stream B with `DeliveryWorkspace`, `DeliveryRegistry`,
`ResolvedDelivery`, and error/port inventory.

### Stream B: Isolated worktree creation and optimistic Git ledger

**Scope**: Implement the Git-native ledger adapter and workspace lifecycle
behind new ports.  Atomically create or resume a delivery's stable ID, feature
branch, linked worktree, registry entry, and initial ledger record using the
existing short mutation-lock protocol plus an expected-ledger-head transaction.
Create `shipyard-ledger` as an orphan history and keep it outside product
ancestry.  Checkpoint operations must reject stale expected heads and same-path
semantic conflicts; retry is explicit after re-read.  Cleanup handoff removes
rebuildable registration/worktree state while preserving ledger history.

**Files**:

- `src/ledger/types.ts`
- `src/ledger/errors.ts`
- `src/ledger/transaction.ts`
- `src/ledger/store.ts`
- `src/adapters/ledger-git.ts`
- `src/workspace/service.ts`
- `src/workspace/errors.ts`
- `test/ledger/transaction.test.ts`
- `test/integration/delivery-workspace/*.test.ts`

**Can Start**: immediately for the ledger port/transaction tests; reconcile to
Stream A's published types before implementing workspace creation/resume.

**Estimated Hours**: 14–16.

**Verification Responsibility**: Disposable local-Git tests prove an orphan
ledger ref is not in product ancestry, feature work is refused on authoritative
`main`, interrupted creation resumes safely, a removed linked worktree can be
recreated from registry state, branch cleanup leaves the ledger reachable, and
the ledger ref is never part of a staged payload/refspec.  Deterministic
interleaving tests prove stale expected SHA rejection, no lost update after a
valid retry, and same-path conflict rejection.

### Stream C: Role-limited envelopes, freshness guard, status contribution, and docs

**Scope**: Define and serialize host-neutral envelopes, role allowlists, and a
pinned reader.  The reader verifies the current product SHA **before** it can
call the ledger reader.  Implementer envelopes contain only contract/assigned
task paths; reviewer envelopes contain intent/acceptance/review state and no
implementation chatter; status receives no delivery-record paths.  Add a pure
delivery status contributor and focused ledger/context documentation.

**Files**:

- `src/context/types.ts`
- `src/context/errors.ts`
- `src/context/envelope.ts`
- `src/context/reader.ts`
- `src/delivery/status.ts`
- `docs/ledger-context.md`
- `test/context/envelope.test.ts`
- `test/context/reader.test.ts`
- `test/delivery/status.test.ts`

**Can Start**: role schema/allowlist tests may start immediately; envelope
creation and pinned-read integration start after A's resolver types and B's
ledger read interface are published.

**Estimated Hours**: 9–11.

**Verification Responsibility**: Prove each role's exact record set, status's
empty set, minimum `{host, role, envelopePath, repoRoot}` adapter call shape,
and that a stale product SHA aborts before the first ledger-record-read spy is
invoked.  Test the status contributor with issue #2's `composeStatus` without
editing its shared projection module.

## Acceptance and Definition-of-Done Mapping

| Requirement | Implementing stream(s) | Verification/evidence owner |
| --- | --- | --- |
| Stable delivery ID, feature branch, linked product worktree, and parallel ledger entry are created/resumed atomically | A defines identity/registry; B implements lifecycle | B: disposable-Git create and interrupted-resume tests |
| Ledger is an orphan `shipyard-ledger` history outside product ancestry | B | B: ancestry/ref assertions and ledger-object inspection |
| Product work directly on authoritative `main` is rejected | B | B: main-branch negative integration test |
| Partial, ambiguous, and conflicting pre-existing workspace state is detected | A resolves/rejects; B validates physical state | A resolver matrix; B interrupted/conflict integration matrix |
| Linked worktrees, explicit IDs, genuine ambiguity, concurrent checkpoints, and stale expected ledger SHAs resolve/fail safely | A (identity/ambiguity); B (checkpoint transaction) | A unit tests; B deterministic concurrent/stale-head tests |
| Implementer/reviewer/status envelopes expose only allowed paths and minimum host-neutral fields | C | C: allowlist and adapter-shape tests |
| Stale product SHA stops before any ledger record is loaded | C | C: ordered spy test proving zero ledger reads |
| Ledger survives product branch deletion and never enters staged destination refspec/payload | B | B: cleanup/retention and excluded-ref integration tests |
| Disposable Git creation, resume, recreation, ambiguity, and final-cleanup handoff coverage | A/B | B aggregates disposable-Git suite; A owns resolver ambiguity fixture |
| PRD AC-008 Ledger isolation | B | B: orphan, retention, and staged-payload exclusion evidence |
| PRD AC-009 Role context | C | C: record-set/host-envelope evidence |
| PRD AC-010 Stale context | C | C: pre-read freshness evidence |
| DoD: no product-branch metadata writes | B | B: tree/ref assertions before and after lifecycle operations |
| DoD: unit, worktree, concurrency, and stale-envelope tests pass | A/B/C | Each stream runs owned tests; B reports aggregate suite after integration |
| DoD: progressive ledger/context documentation is complete | C | C: focused doc link and command-shape checks |
| DoD: acceptance evidence names exact product SHA and verifier | Integration owner after implementation, not a stream self-approval | Separate exact-SHA evidence record; no pass claim in this plan |
| DoD: no unresolved independent-review finding | Independent reviewer after exact-SHA integration | Separate reviewer receives issue intent, test results, and exact SHA |

## Coordination and ownership

| Surface | Sole owner | Consumer rule |
| --- | --- | --- |
| `src/delivery/{types,errors,registry,resolver}.ts` | A | B/C consume A's documented ports; changes require A handoff. |
| `src/ledger/**`, `src/adapters/ledger-git.ts`, `src/workspace/**` | B | A provides no physical Git implementation; C reads only through B's ledger read port. |
| `src/context/**`, `src/delivery/status.ts`, `docs/ledger-context.md` | C | B never builds role policy; C does not own workspace/ledger mutations. |
| `src/index.ts` | Delayed one-file integration after A/B/C | Add only the final public exports after all stream APIs settle; serialize this edit and coordinate if issue #4 has begun exports. |
| Existing `src/status/projection.ts` | Issue #2 contract owner | C composes a contributor; it does not edit the shared projection. |

### Explicit issue #4 exclusion

Issue #3 must not edit `src/adapters/git.ts`, introduce `src/adapters/github*`,
or create `src/provider/**`; it must not edit credential, GitHub, issue/PR, or
provider-recovery documentation.  The only planned cross-issue integration is
that a later issue #4 provider checkpoint may be stored through B's generic
ledger transaction port and may contribute provider fields alongside C's pure
delivery status contributor.  That integration takes typed IDs/URLs/SHAs as
data and does not give issue #3 provider authority.

## Execution order

1. Start A and B's isolated port/test work in parallel.
2. A publishes resolver/registry ports; B completes physical create/resume and
   transaction behavior against them.
3. C finalizes pinned envelope creation/reading after B publishes the ledger
   read port; its role-policy unit tests can proceed earlier.
4. Reconcile the one shared public-export edit only after the three owned
   suites pass.  Then run typecheck, full tests, disposable-Git suite, and an
   independent exact-SHA review/evidence gate.

This preserves two useful initial work lanes without overlapping files, while
making creation/resume and the envelope reader consume one settled source of
truth rather than inventing parallel delivery state.
