---
issue: 5
title: Deliver safe baseline and source-ref synchronization
analyzed: 2026-08-04T00:00:00Z
product_head_inspected: 972cb1b75e6bca766a9489fd928e17431ad9fee1
estimated_hours: 28
parallelization_factor: 1.4
status: planned
---

# Parallel Work Analysis: Issue #5

## Grounding and fixed boundary

This is the narrow `shipyard-sync` slice for issue #5.  It was grounded in the
issue, epic, full v1 PRD, accepted issue #2 evidence/review at
`bba2e5e083ea460deba92ffa686b986b8102067f`, and the current issue #3/#4
plans.  The inspected product head is
`972cb1b75e6bca766a9489fd928e17431ad9fee1`, which already contains the
issue #2 binding/classifier/lock contracts, issue #3 ledger/context/workspace
contracts, and issue #4 scoped REST and authenticated-Git transport boundaries.

Sync is baseline synchronization and optional read-only source import only. It
never promotes, finalizes, merges, creates/closes provider records, force
pushes, rebases, resolves conflicts, repairs a branch, rewrites feature work,
or mutates `NativeInteractive`. Command-scoped `visualjc` authority remains
mandatory: actor/repository/operation authority comes only from the freshly
verified bound profile; no ambient `gh` identity is read or changed. The
existing authenticated-Git boundary is consumed with an ephemeral credential,
redacted diagnostics, named remotes, inherited helpers disabled, and no token
in a URL, argv, status, log, or ledger.

`shipyard-status` remains read-only: it acquires no mutation lock, fetches no
objects, imports no source ref, writes no provenance, and loads no delivery
records. It may inspect local refs/configuration through a read-only sync
status reader and report a blocker plus the next safe command.

## Public contracts and invariants

Stream A publishes the following typed, serializable contract inventory before
Stream B starts its service integration:

- `SyncRequest` is `{ repositoryPath, sourceRef?: string }`; an omitted
  `sourceRef` means default baseline sync, while a source import requires a
  non-empty explicitly supplied destination ref. No implicit current branch,
  default tag, or wildcard is legal.
- `SyncAuthority` identifies the verified common directory, configured actor,
  topology, development remote/default branch, authoritative destination
  remote/default branch, and the validated profile-owned path policy. Staged
  pairs use destination `main` as authority; single-repository bindings resolve
  their sole repository explicitly rather than guessing a second remote.
- `BaselineObservation` carries clean-state result, local development-main
  SHA, authoritative destination-main SHA, ancestry relation, remote identity,
  relevant changed paths, and Git object format. Object IDs accept only
  lowercase full SHA-1 (40) or SHA-256 (64); mixed/truncated IDs block.
- `SourceProvenance` records schema version, authoritative remote name/URL,
  explicit requested ref, deterministic local `refs/shipyard/source/...` ref,
  resolved object SHA and object format, observed time, and ledger checkpoint
  SHA. A later use must re-resolve the remote/ref and require exactly the same
  remote/name/SHA; Git's local ref is policy-read-only, not assumed immutable.
- `SyncOutcome` is an immutable result/status input containing baseline/source
  freshness, blockers, and next safe action. It contains no credential and
  does not authorize a later promote/finalize operation.

Before any write, the service must revalidate binding/profile fingerprint,
operation allowlist, exact named remote URL/owner/name, clean worktree/index,
checked-out authoritative development default branch, no divergence, allowed
fast-forward relation, and the shared `classifyProfilePath` result for every
relevant changed path. Unclassified or multi-owner paths block. A successful
baseline operation makes local development `main` equal *exactly* to the
authoritative destination `main` by fast-forward only. A source import must
not move `main` or feature refs. The source namespace is excluded from every
Shipyard product push/refspec/payload validation; detecting it in a proposed
publication blocks rather than removes or repairs it.

## Parallel streams

### Stream A: authority, validation, provenance, and pure status contracts

**Scope:** Define sync errors/types, derive source and destination exclusively
from fresh bound-profile authority, validate safe ref/name/object-ID forms,
canonicalize a deterministic source namespace path, classify relevant paths
through the issue #2 one-owner classifier, validate immutable provenance, and
provide a pure status contributor/formatter input. It makes no Git mutation,
network request, lock acquisition, CLI command, or ledger transaction.

**Exclusive files:**

- `src/sync/types.ts`
- `src/sync/errors.ts`
- `src/sync/authority.ts`
- `src/sync/provenance.ts`
- `src/sync/status.ts`
- `test/sync/authority.test.ts`
- `test/sync/provenance.test.ts`
- `test/sync/status.test.ts`

**Dependencies:** May start now against the accepted Issue #2 binding/profile/
classifier contracts and the current `BoundProfileAuthorityResolver`. It reads
but does not edit `src/contracts/**`, `src/profile/**`, `src/binding/**`,
`src/policy/path-classifier.ts`, `src/locking/**`, `src/status/projection.ts`,
or `src/index.ts`.

**Verification responsibility:** Table tests cover staged-pair versus
single-repository authority, operation denial, profile-fingerprint drift,
unexpected remote identity, unsafe/wildcard/refspec-like source input, SHA-1
and SHA-256 acceptance, malformed/truncated/mixed IDs, deterministic
namespace collision resistance, provenance remote/name/SHA drift, and each
path classification failure. Prove its status contribution is pure and has no
ledger-reader, transport, lock, or write capability.

### Stream B: locked Git synchronization and source-ref import

**Scope:** Implement the only mutation service and its narrow Git/credentialed
transport adapter. Under one short common-directory sync lock, take a fresh
observation, perform the complete preflight, and either (a) fast-forward local
development `main` exactly to the verified authoritative destination `main`,
or (b) fetch one exact explicitly named authoritative-destination ref into the
canonical `refs/shipyard/source/...` namespace and write validated provenance
through the generic isolated-ledger transaction port. Re-observe after each
external Git step and fail closed if facts changed. Retrying is an explicit new
command after fresh observation; there is no automatic retry, rebase, repair,
or conflict resolution.

**Exclusive files:**

- `src/sync/git.ts`
- `src/sync/transport.ts`
- `src/sync/service.ts`
- `src/adapters/sync-git.ts`
- `test/sync/service.test.ts`
- `test/sync/transport.test.ts`
- `test/integration/sync/baseline.test.ts`
- `test/integration/sync/source-ref.test.ts`
- `test/integration/sync/sha256.test.ts`

**Dependencies:** Stream A's contract inventory; current `MutationLockService`,
`LedgerStore`, `GitLedgerStore.requireProductOnlyTransport`, and Issue #4's
credentialed command-runner/credential types. It must add a destination-target
transport capability with the same isolation/redaction rules rather than use
`GitTransportService.run`, whose present authority is deliberately restricted
to the development remote. The adapter must not weaken or edit the issue #4
transport boundary; a narrowly reviewed shared-factory handoff, if truly
needed, is serialized after Stream B passes its own tests.

**Verification responsibility:** Disposable local-Git integration tests prove
clean fast-forward to the exact destination commit; dirty worktree/index,
wrong checked-out branch, remote URL/owner mismatch, non-fast-forward,
ahead/diverged baseline, changed observation, unsafe path, and lock contention
all leave refs unchanged. Fake transport tests prove destination authority is
chosen from the bound topology, no `gh` invocation/global-account mutation or
`NativeInteractive` path exists, and credentials are only child-environment
values and are redacted. Source tests prove no input/no import, exact named
branch/tag/ref import only, no wildcard/default inference, no `main` or
feature-ref movement, provenance checkpointing, remote/name/SHA revalidation,
and rejection of source refs in product refspecs/payloads. Run the same matrix
in SHA-1 and SHA-256 disposable repositories.

### Stream C: command, read-only status integration, focused docs, and final handoff

**Scope:** Wire the narrow `shipyard-sync` executable/CLI and focused Codex
skill/reference after A/B APIs settle. Compose sync facts into existing status
without changing the shared projection shape or acquiring a lock. Add focused
synchronization/recovery documentation that says exactly which safe operator
action follows each stop state. This stream owns the only planned edits to
already-completed Issue #2 command/help surfaces and serializes them as an
explicit integration handoff.

**Exclusive files:**

- `src/commands/sync.ts`
- `src/cli/sync.ts`
- `bin/shipyard-sync`
- `skills/shipyard-sync/SKILL.md`
- `skills/shipyard-sync/agents/openai.yaml`
- `skills/shipyard-sync/references/sync.md`
- `docs/synchronization.md`
- `docs/sync-recovery.md`
- `test/cli/sync.test.ts`
- `test/integration/sync/command-status.test.ts`

**Serialized integration files (one owner after A/B handoff):**

- `src/cli/main.ts`
- `src/cli/runtime.ts`
- `src/commands/status.ts`
- `docs/help.md`
- `README.md`
- `package.json`
- `src/index.ts`

**Dependencies:** A and B both pass and publish their APIs. Existing
`src/status/projection.ts`, issue #3 delivery/context/ledger/workspace files,
and issue #4 GitHub/provider files are read-only inputs; C must not revise
their contracts. `src/index.ts` is changed only in this delayed integration
step, after reconciling with its completed public-barrel owner.

**Verification responsibility:** CLI/package-discovery tests prove the new
command/skill/reference are installed and help is focused. Status tests use
spies to prove no mutation-lock acquisition, Git fetch/update, source import,
ledger transaction/read, provider call, or delivery-record load. Command tests
prove actionable next actions for clean sync, dirty/diverged state, source
provenance drift, and manual-recovery/lock states. Documentation examples must
never imply promotion, rebase, automatic repair, account switching, or source
publication.

## Adversarial acceptance matrix

| Scenario | Required result | Owner |
| --- | --- | --- |
| Clean staged-pair baseline; destination ahead | Development `main` fast-forwards to exactly destination `main` | B |
| Dirty worktree or index | Stop before fetch/ref/ledger write; explain cleanup and rerun | B |
| Development ahead, divergent, non-FF, conflict, or branch not `main` | Stop; never rebase/reset/merge/resolve | B |
| Binding/profile/actor/remote identity changes while waiting or operating | Stop before mutation or after re-observation; no repair | A/B |
| Relevant changed path unclassified or conflicting | Stop before baseline update/import | A/B |
| Omitted, wildcard, malformed, or ambiguous source ref | No fetch/import | A/B |
| Explicit branch/tag/full ref | Import only its verified object to canonical source namespace; leave product refs unchanged | B |
| Remote/ref/object SHA changes after recorded import | Mark provenance stale and block use; do not overwrite/republish | A/B |
| SHA-1 and SHA-256 repository | Full 40/64 IDs round-trip and compare exactly | A/B |
| Source namespace in push refspec or product payload | Reject publication boundary; leave refs untouched | B |
| Lock held/stale/transition ambiguity | No concurrent mutation; manual recovery guidance, never automatic recovery | B/C |
| `shipyard-status` | Reads only local sync facts; zero lock/fetch/write/ledger/delivery/provider activity | C |
| Any sync failure | No provider write, promotion/finalization, force push, branch repair, `gh` switch, or `NativeInteractive` mutation | B/C |

## Dependency order, coordination, and exclusions

1. Start A's pure contracts/tests. B may build disposable-Git fixtures and its
   adapter shell, but cannot settle service behavior until A publishes types.
2. B consumes A, the issue #2 classifier/lock, issue #3 generic ledger port,
   and issue #4 authenticated transport primitives. It owns every sync write.
3. C begins only after B's API and deterministic integration tests pass. It
   performs the single serialized CLI/runtime/status/package/barrel handoff.
4. Run typecheck, full deterministic tests, the SHA-1/SHA-256 disposable-Git
   suites, packaged CLI/skill discovery, then exact-SHA acceptance evidence and
   an independent review in a separate context.

No stream edits `src/delivery/**`, `src/ledger/**`, `src/context/**`,
`src/workspace/**`, `src/github/**`, `src/adapters/git-transport.ts`, or the
issue #2 core binding/classifier/lock/status-projection contracts. Issue #5
does not persist a provider checkpoint, create a delivery, change GitHub issue
or PR behavior, or implement promotion/finalization. Source provenance is a
generic isolated-ledger record, never destination payload or provider metadata.

## Evidence and integration gate

The implementation is eligible for acceptance only when one exact integrated
product SHA has: a clean worktree; `git diff --check`; typecheck; the full
deterministic suite; SHA-1 and SHA-256 local-Git baseline/source matrices;
credential-redaction/no-global-`gh`/no-`NativeInteractive` probes; packaged
`shipyard-sync` plus skill/reference discovery; read-only status spy evidence;
and explicit AC-005/AC-006 evidence naming verifier and time. An independent
reviewer receives only issue intent, exact SHA, test commands/results, docs,
and evidence; no stream self-certifies acceptance or review. Any accepted
finding, stale SHA, incomplete provenance, unsafe classifier result, or
unexplained lock state blocks the gate.
