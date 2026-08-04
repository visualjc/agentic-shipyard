---
issue: 10
title: Add experimental graph freshness adapters
analyzed: 2026-08-04T00:00:00Z
product_head: 972cb1b75e6bca766a9489fd928e17431ad9fee1
estimated_hours: 20-28
parallelization_factor: 1.4
status: planned
---

# Parallel Work Analysis: Issue #10

## Grounding and boundary

This is an implementation plan only, not an implementation, acceptance result,
or approval.  It is grounded in issue #10, the Shipyard v1 epic and PRD
(especially FR-006, FR-018, FR-019, NFR-002, NFR-003, NFR-005, NFR-007, and
AC-022), and the Wayfinder graph research and synthetic worktree-freshness
prototype.  Product inspection is at the clean exact HEAD
`972cb1b75e6bca766a9489fd928e17431ad9fee1`.

The current product already supplies narrow Git/filesystem/process ports,
common-directory binding/workspace resolution, conservative mutation-lock
recovery, and a composable read-only status projection.  It has no graph
domain, graph adapter, runtime probe, or graph documentation.  This issue adds
only the optional local graph lane.  It must not alter provider, credential,
ledger, workspace, acceptance/review, promotion, or finalization authority.

The sole graph authority is a descriptor that matches **both** the current
exact Git `HEAD` commit and a deterministic working-tree fingerprint, has the
reviewed adapter source receipt, and names one canonical worktree root and one
private cache identity.  A matching commit alone is insufficient.  A baseline
is immutable and keyed by its exact authoritative-main SHA; it can seed a
private cache only after that adapter's verified seed procedure.  Divergent
worktrees never share mutable cache/output/lock state, including where they
share a Git common directory or were recreated at the same path.

Graphs are explicitly experimental, profile-enabled, and disabled by default.
They are an acceleration only: `disabled`, `unavailable`, `stale`, `invalid`,
`blocked`, or failed refresh all return a source-inspection fallback action,
never block feature work and never authorize stale graph output.  The status
surface must expose enabled/disabled and fresh/stale/unavailable/blocked state
plus that fallback action without making status write, refresh, or install a
tool.

Wayfinder evidence fixes the adapter promises at the reviewed pins only:

- Graphify `0.9.32` at
  `00efd6e7969837ae4a9f11d8d504dcd3b20b09df` uses a private external output,
  `--code-only`, and disabled query logging.  The wrapper must set **both** an
  absolute `GRAPHIFY_OUT=<private-cache>/graphify-out` and matching `--out`;
  after every seed/refresh it verifies no Graphify output appeared beneath the
  product worktree.  `--out` alone leaked `graphify-out/cache/stat-index.json`
  in the prototype.
- CodeGraph `1.5.0` at
  `49c11fc2e0c02170742be8411e66a31af611f4b7` remains worktree-local because
  upstream does not document an external cache root.  Before init, restore, or
  refresh the adapter verifies the selected Node runtime by actually creating
  an in-memory SQLite FTS5 virtual table, sets telemetry off, adds
  `.codegraph/` to that worktree's machine-local Git `info/exclude`, and proves
  it is ignored/absent from tracked product changes.  Copying an exact-main
  `.codegraph` seed is **empirically observed at this pin**, not an
  upstream-supported guarantee; user-facing text must say exactly that.
- Understand Anything is not an adapter, cache source, status authority, or
  feature-worktree fallback in v1.  Its default redirect-to-main behavior and
  unproven semantic storage/privacy/seed behavior make it deferred.  A labeled
  exact-main orientation artifact, if ever separately added, cannot represent
  current feature-worktree state.

All default tests use disposable local Git fixtures and deterministic fake
adapters/runtimes.  They neither install Graphify/CodeGraph nor send source,
queries, documents, images, or telemetry to any provider.  Real binary probes
are separately opt-in, require an already installed reviewed receipt and an
explicit local-only approved profile, and never operate on proprietary code.

## Public contract before adapter work

Stream A publishes the following stable, serializable contract before either
adapter begins integration:

```text
GraphSource = { worktreeRoot, headSha, workingTreeFingerprint }
GraphDescriptor = {
  adapter, reviewedToolSource, cacheIdentity, cacheRoot, worktreeRoot,
  indexedCommit, workingTreeFingerprint, refreshedAt
}
GraphDecision = {
  state: disabled | fresh | stale | unavailable | invalid | blocked | failed,
  authoritative: boolean, fallbackAction: "inspect-source-directly", reason
}
GraphAdapter = probe -> seed? -> refresh -> status
```

`worktreeRoot` and all cache roots are canonical absolute paths.  `cacheIdentity`
includes adapter, reviewed tool source, canonical worktree root, and exact
baseline SHA when seeded; it is not derived from branch name, common directory,
or a process-local handle.  The fingerprint algorithm must be Git-native and
cover the `HEAD` tree plus staged and unstaged tracked changes (including
deletions, executable mode, symlink, rename, submodule, and untracked paths
that policy permits an adapter to scan); it is canonical, versioned, and
recomputed after process restart.  If Git/fingerprint input is unavailable or
ambiguous, the decision is non-authoritative fallback.

The core decision is pure and never invokes a process or trusts adapter
presentation.  Descriptor mismatch (adapter/pin/cache root/worktree root),
commit mismatch, fingerprint mismatch, an unverified stale lock, unavailable
runtime, failed command, missing output, or failed relocation verification is
non-authoritative.  A refresh can publish a descriptor only after the adapter
has completed and its postconditions verify against a freshly read source
snapshot; any source change during refresh yields `stale`/fallback rather than
an optimistic pass.

## Parallel streams

### Stream A — Graph authority, fingerprints, state machine, and fake seam

**Scope:** Create the tool-independent graph domain: canonical source snapshot
and fingerprint port, descriptor validation, private cache identity, pure
freshness/restart/lock decision, adapter interfaces, and deterministic fake
adapter/runtime fixtures.  It specifies—but does not execute—adapter commands.
It is the only stream allowed to define graph states and the exact fallback
action.

**Exclusive files:**

- `src/graph/types.ts`
- `src/graph/errors.ts`
- `src/graph/fingerprint.ts`
- `src/graph/freshness.ts`
- `src/graph/adapter.ts`
- `test/graph/fingerprint.test.ts`
- `test/graph/freshness.test.ts`
- `test/graph/helpers/fakes.ts`

**Published contract:** `GraphSource`, `GraphDescriptor`, `GraphDecision`,
`GraphAdapter`, `GraphRuntime`, `GraphCacheLock`, `snapshotGraphSource`, and
`evaluateGraphFreshness`.  The fake exposes scripted probe/seed/refresh/status
calls and records arguments/environment locally; it cannot spawn a process,
contact a provider, install software, or read an arbitrary production tree.

**Can start:** immediately, consuming existing Git/process/filesystem narrow
ports only.  It does not edit them, `src/status/projection.ts`, `src/index.ts`,
or any existing lock implementation.

**Verification responsibility:** deterministic unit matrices prove commit and
dirty fingerprint mismatch, checkout, rebase, staged/unstaged/untracked
changes, descriptor/tool-pin/root mismatch, process restart, cache recreation,
and failure during refresh all deny authority and select direct inspection.
Lock tests distinguish a live refresh from a stale/cross-host/dead-owner lock;
they require verified recovery and never auto-delete an unknown lock.  Two
same-common-directory divergent-worktree fixtures prove separate cache
identities and prohibit a shared mutable descriptor.  The fake-call trace
proves source snapshot is recomputed after refresh and no external tool is
needed for the entire suite.

### Stream B — Graphify experimental wrapper and relocation proof

**Scope:** Implement the Graphify-only adapter against Stream A's contract,
its reviewed-receipt/profile-flag preflight, external private baseline/cache
layout, seed/refresh invocation, output relocation audit, and Graphify-focused
documentation.  The adapter supports only code-only offline operation and
does not invoke installers, hooks, MCP setup, documentation/image modes, or an
LLM.

**Exclusive files:**

- `src/adapters/graphify.ts`
- `src/graph/graphify.ts`
- `docs/graphify-experimental.md`
- `test/adapters/graphify.test.ts`
- `test/graph/graphify.test.ts`

**Input/output contract:** consume only Stream A's types plus injected command,
filesystem, and profile/receipt readers.  It returns a `GraphDecision` and
descriptor; it never changes profile configuration, writes a ledger, mutates a
Git remote, or makes a graph authoritative by itself.  A seed is copied from
an exact-main immutable descriptor to a newly allocated per-worktree cache;
any baseline mismatch skips seeding and performs a fresh private build or
falls back.

**Can start:** command-shape and relocation-audit tests can start immediately
against local placeholder types; implementation integration waits for A's
published contract.  It has no dependency on Stream C.

**Verification responsibility:** fake-command tests require explicit enabled
flag and exact reviewed source receipt; disabled means no probe/process/write.
They inspect `--code-only`, absolute matching `GRAPHIFY_OUT` and `--out`,
`GRAPHIFY_QUERY_LOG_DISABLE=1`, and a private output root.  Synthetic files
model the known `--out`-only leak: any `graphify-out/**` product-tree artifact
causes failed/non-authoritative fallback.  Tests cover seed/incremental update,
two divergent worktrees, commit/dirty edit/revert, checkout/rebase, restart,
same-path worktree recreation, stale lock, unavailable executable, non-zero
refresh, changed source during refresh, and no sharing of cache or lock paths.
No test downloads Graphify or scans proprietary source.

### Stream C — CodeGraph experimental wrapper, runtime/exclusion proof

**Scope:** Implement the CodeGraph-only adapter against Stream A's contract,
its reviewed-receipt/profile preflight, actual Node/SQLite FTS5 capability
probe, per-worktree `.codegraph/` lifecycle, machine-local exclusion check,
empirical seed wording, and focused documentation.  It cannot use
`CODEGRAPH_DIR` to claim a central external cache, run an installer/MCP setup,
or mutate tracked ignore files.

**Exclusive files:**

- `src/adapters/codegraph.ts`
- `src/graph/codegraph.ts`
- `docs/codegraph-experimental.md`
- `test/adapters/codegraph.test.ts`
- `test/graph/codegraph.test.ts`

**Input/output contract:** consume Stream A's interfaces and injected local
Git/filesystem/process/runtime probes.  It returns descriptor/decision only;
it does not alter shared path policy, profile bindings, ledger, GitHub, or
Graphify state.  Its cache identity always includes the individual canonical
worktree root.  A copied baseline `.codegraph` cache is permitted only after
the baseline/source receipt matches and must be presented as empirical at the
reviewed pin; otherwise initialize the worktree-local index or fall back.

**Can start:** fake runtime/exclusion fixtures can start immediately;
implementation integration waits for A.  It is independent of B.

**Verification responsibility:** deterministic fake runtime proves that a
Node version string is not accepted in place of the actual `node:sqlite` FTS5
probe; unavailable/failed FTS5 gives unavailable/fallback before `init`.
Command/exclusion traces prove `CODEGRAPH_TELEMETRY=0`, no installer, and that
the machine-local `info/exclude` entry is established and verified before
init/restore/refresh; a staged `.codegraph/.gitignore` or tracked cache causes
non-authoritative fallback.  Synthetic two-worktree tests cover empirical
seed, independent refresh, dirty/commit/rebase/checkout/restart/recreation,
stale/dead/cross-host locks, lost cache, and unavailable/failed tools.  The
suite uses fake adapters only—no Node installation, CodeGraph installation,
network, telemetry, or proprietary code.

### Stream D — Serialized status, public exports, and operation documentation

**Scope:** After A, B, and C hand off their tested public inventories, integrate
the graph status contributor into the existing read-only projection, expose the
settled graph contracts/adapters from the barrel, and add the narrow status and
metadata references.  This is deliberately a small serialized integration
slice, not a fourth graph implementation.

**Exclusive files:**

- `src/graph/status.ts`
- `src/status/projection.ts`
- `src/index.ts`
- `docs/status.md`
- `docs/metadata-ownership.md`
- `test/graph/status.test.ts`
- `test/status/projection.test.ts`

**Contract:** extend the existing `graphFreshness` vocabulary to represent
`disabled`, `fresh`, `stale`, `unavailable`, `invalid`, `blocked`, and `failed`
without weakening existing contributors.  The graph contributor projects the
enabled flag, adapter name/receipt, state, reason, and exact
`inspect-source-directly` next action through a typed graph status field (not
an overloaded provider field).  It must preserve a more restrictive existing
blocker/next-safe action, be deterministic, and never spawn/refresh/install or
read arbitrary delivery records from status.  Documentation labels adapters
experimental/disabled-by-default, records the privacy/local-only constraints,
and says CodeGraph seeding is empirical rather than upstream guaranteed.

**Can start:** only after A/B/C contracts and tests have passed.  It is the
single approved handoff for shared `src/status/projection.ts` and `src/index.ts`;
none of A/B/C may edit those files.

**Verification responsibility:** projection tests cover disabled, fresh,
stale, unavailable, invalid, blocked, and failed states; assert stale and
unavailable graphs select direct source inspection and cannot be rendered as
fresh by adapter/provider presentation.  Read-only command tests prove status
does not acquire locks, launch tools, create caches, or install dependencies.
Documentation tests assert explicit flags, Graphify relocation verification,
CodeGraph Node/FTS5/exclusion and empirical seed language, privacy limits, and
the absence of Understand Anything as an authoritative option.

## Ownership and dependency order

| Order | Stream | Depends on | Handoff / no-overlap rule |
| --- | --- | --- | --- |
| 1 | A | completed issues #2/#3 binding/workspace/lock ports | Publishes the only graph state, authority, fingerprint, fake, and adapter interfaces. |
| 2a | B | A contract | Owns Graphify files only; cannot alter shared status/barrel or CodeGraph. |
| 2b | C | A contract | Owns CodeGraph files only; cannot alter shared status/barrel or Graphify. |
| 3 | D | A + B + C passing inventories | Sole serialized editor of status projection and public barrel; it consumes adapters, never implements their commands. |
| 4 | integration verifier | D and all owned suites | Runs aggregate verification and produces exact-SHA evidence; it does not retroactively broaden a stream. |

`src/adapters/git.ts`, `src/adapters/filesystem.ts`, `src/adapters/process.ts`,
`src/locking/**`, `src/workspace/**`, `src/delivery/**`, `src/ledger/**`,
`src/context/**`, `src/github/**`, evidence/review, public command dispatch,
and all skills remain read-only inputs for this issue.  If a missing narrow
port becomes necessary, stop and record a separate owner handoff rather than
editing a foreign surface or broadening the adapter.

## Adversarial acceptance matrix

| Situation | Required decision | Machine-verifiable proof |
| --- | --- | --- |
| HEAD changes, dirty edit/stage/revert, checkout, or rebase | stale until refreshed against newly captured commit **and** fingerprint | fake Git snapshots plus descriptor mismatch matrix |
| Process restart or same-path worktree recreation | re-resolve canonical root and recompute source; reusable cache only after identity match | fresh fake process; recreated fixture path with old descriptor/cache |
| Two divergent linked worktrees | isolated private cache and lock identities; sibling symbols never appear | paired synthetic worktree/cache fixtures |
| Live, stale, malformed, dead-owner, or cross-host cache lock | block or manual verified recovery; never trust/auto-remove unknown state | injected clock/process ownership table |
| Tool missing, pin/receipt mismatch, FTS5 failure, command failure, missing output, or changed source during refresh | unavailable/invalid/failed then `inspect-source-directly` | fake executable/runtime/filesystem traces, zero stale graph reads |
| Graphify output relocation is incomplete | failed/fallback; product tree left clean | deliberate `--out`-only leak and post-run tree audit |
| CodeGraph exclusion is absent or cache becomes staged | failed/fallback before graph use | fake `info/exclude`/index trace and tracked-cache negative fixture |
| Graph disabled or profile lacks explicit local-only approval | disabled/fallback, no process/cache write | no-call/no-write fake assertions |
| Understand Anything selected or presented as current feature graph | unsupported/deferred, never authoritative | absent adapter registry/status option assertion |

## Completion and evidence protocol

After D, run `npm run typecheck`, `npm test`, all graph unit/adapter/status
tests, and a disposable-local-Git integration matrix using only the deterministic
fakes.  An optional real-adapter probe is a separate, explicitly approved,
already-installed reviewed-pin check on a synthetic fixture; it may not be
required for ordinary CI and cannot transmit proprietary code or install tools.

Before marking the issue complete, capture the exact final product SHA, clean
working-tree state, command results, fake-adapter call traces, fixture
fingerprints, and verifier identity in the normal exact-SHA evidence process.
Any product change invalidates that evidence and requires a new source snapshot,
test run, and independent review.  CCPM task state, GitHub state, an adapter's
self-report, or a cache timestamp is never graph freshness or acceptance
authority.
