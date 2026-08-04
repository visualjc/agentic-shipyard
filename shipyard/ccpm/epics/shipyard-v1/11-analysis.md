---
issue: 11
title: Harden recovery and prove release readiness
analyzed: 2026-08-04T00:00:00Z
product_head_inspected: 3fd4858fbb007233cc93ad6fb93282d55fa11cad
depends_on: [2, 3, 4, 5, 6, 7, 8, 9, 10]
status: planned-blocked-on-integrated-6-10-and-implemented-7-9
estimated_hours: 36-48
parallelization_factor: 1.15
---

# Parallel Work Analysis: Issue #11

## Grounding, release boundary, and current frontier

This is the final release-gate plan, not a release result, implementation
authorization, live-fixture authorization, or permission for a GitHub/remote
mutation. It is grounded in task #11; the v1 PRD (all AC-001..AC-023 and
DOD-001..DOD-012); the resolved Wayfinder v1 and toolchain decisions; the
local lifecycle, ledger/context, host-context, GitHub-lifecycle, and graph
prototypes; and the accepted #2--#5 evidence. The inspected product head is
`3fd4858fbb007233cc93ad6fb93282d55fa11cad`, accepted only for #5. It is not a
release candidate and cannot inherit a release pass.

Issue #11 is blocked until #6 and #10 are accepted, independently reviewed,
and integrated, and #7, #8, and #9 are implemented, independently reviewed,
and integrated at a common product SHA. #4's provider code has deterministic
coverage but its live private-fixture gate remains unapproved. Planning files,
task checkboxes, an issue/PR state, a passing sub-suite, a prototype, and a
caller-provided SHA are non-authoritative observations.

The release authority is a code-created audit of one exact clean release
candidate SHA (RC SHA), its immutable ledger evidence, current independent
review, and the declared test results. Any product commit after collection
invalidates all RC acceptance/review results. The only allowable terminal
states are:

| State | Meaning | Safe next action |
| --- | --- | --- |
| `not-ready` | prerequisite issue/API or candidate state is missing | finish and accept the named prerequisite |
| `deterministic-ready-external-gate-pending` | all local/fake coverage and RC audit pass; private GitHub fixture was intentionally skipped | obtain a separate reviewed fixture authorization or ship only an explicitly non-release initial PR |
| `release-ready` | deterministic audit, private fixture, RC review, and all AC/DoD records pass at one unchanged SHA | human release decision; Shipyard still does not merge |
| `blocked` / `manual-recovery` | exact observation is stale, ambiguous, conflicting, or unsafe to repeat | follow the named runbook; never retry a mutation by guess |

No stream may switch global `gh`, mutate `NativeInteractive`, a Just Games
repository, a real remote, or the retired fixture. All default testing is
disposable local Git plus fake provider/process/filesystem adapters. A future
live run must use a code-owned, reviewed, private synthetic allowlist and a
verified command-scoped `visualjc` credential; it must leave global `gh`
configuration unchanged. It is an external gate, not an implementation detail
that this task may quietly bypass.

## Release state-machine and recovery audit

Stream A owns a shared audit inventory, not a second lifecycle implementation.
It enumerates every external mutation owned by #3--#10 and maps it to a durable
checkpoint, idempotency key, pre-write revalidation, post-write reconciliation,
retry result, and manual-recovery condition. A checkpoint must distinguish
`pending`, `applied-by-this-invocation`, `observed-complete`, `conflict`, and
`unsafe-to-repeat`; a boolean `done` is insufficient.

| Boundary | Required precondition / postcondition | Recovery rule |
| --- | --- | --- |
| binding/worktree/registry | canonical common directory, topology/profile fingerprint, live repository identity | stale/malformed/replaced state blocks and requests setup/rebind; never overwrite binding |
| ledger CAS / seal | expected ledger head and exclusive ledger lock; resulting ref re-read | stale head re-reads and detects same-path semantic conflict; never overwrite or infer a seal SHA from its own contents |
| source-ref import / sync | clean non-divergent baseline and exact remote/name/SHA provenance | only prove the recorded import/FF; drift, a different object, or ambiguous ref is manual recovery |
| review dispatch | fresh bound product SHA and reviewer-only envelope; newly observed process identity | failed/timeout/ambiguous child yields no review record; changed SHA requires a new envelope and review |
| staged PR create/revise | fresh #6 decision, classified Git tree, current destination base/head, shared lock | discover only an invocation-owned idempotency record; never create a replacement PR, amend, or force-push |
| single-PR dossier/readiness | exact existing same-repo PR head/base and current evidence/path receipt | retry reconciles the exact marker; replaced/retargeted/human-modified state blocks |
| human merge observation | expected PR, head/tree/base and merged state | Shipyard never merges; closed-unmerged/wrong head/reopened state blocks |
| final seal/tag/sync/close/delete | verified human merge and ownership of each resource | each subsequent step re-observes the target; close/delete only the exact invocation-owned branch/issue/PR and preserve user changes |
| graph refresh/cache | exact source fingerprint, canonical worktree/cache identity and verified lock | stale/unknown/cross-host lock or source change falls back to direct inspection; never trusts/removes unknown cache state |

Fault injection must stop immediately before and immediately after every row's
write, then restart in a fresh process. Tests assert exactly one durable
idempotency record and no duplicated issue, PR, commit, tag, ledger revision,
or cleanup. They also simulate SIGTERM/timeout, child process-group kill,
release/acquire races, dead local owner, live owner, unknown/cross-host owner,
clock skew, lost worktree/cache, stale remote observation, changed source SHA,
and a user/human change between Shipyard read and write.

## Security, isolation, and hostile-input matrix

The release audit consumes narrow adapters rather than trusting public helper
inputs. It must show that hostile input becomes a sanitized blocker before a
write and that no authority can be forged through a status, manifest, ledger,
descriptor, provider response, prototype, or CLI argument.

| Surface | Required deterministic adversarial proof |
| --- | --- |
| actor and credential | `visualjc` API identity is observed immediately before each GitHub mutation; no global account switch; inherited helpers disabled; token absent from argv, remote URL, env snapshots, stdout/stderr, errors, ledgers, payload/dossier, test snapshots, and docs |
| command/process | fixed executables/allowlisted arguments, bounded stdout/stderr/JSON, timeout ceiling and process-group termination; malicious child output, inherited environment, reused reviewer/session, shell metacharacters, and enormous streams fail redacted |
| filesystem/path | canonical roots and `lstat` component checks reject traversal, absolute/drive paths, `..`, NUL/control names, symlink/junction swaps, hardlink/reparse escape, TOCTOU rename, writable parent, hostile mode, and product-tree graph/cache/lock leak |
| locks/resources | one common-directory/delivery canonical lock scope; independent factories contend; dead same-host recovery requires process/token validation; live, malformed, cross-host, or replacement locks never auto-delete |
| ledger/ref/payload | detached deep snapshots reject getters/proxies/unknown keys; CAS/atomic ref update has rollback and reread; ledger/source/proof refs are excluded from payload/push; Git-native tree comparison covers binary, executable, symlink, rename, deletion, unusual names, and permitted gitlinks |
| provider/PR | fake API rejects actor/owner/repository/topology mismatch, destination issue write, fork/cross-repository/retargeted/replaced PR, changed head/base/merge, replayed idempotency token, and post-write human edits; errors are bounded and redacted |
| graph/dependency/docs | modified/duplicate/missing/newer dependency, invalid receipt, stale dirty graph, Graphify relocation leak, CodeGraph tracked cache/telemetry, unsupported host, and a public example implying deferred host support all block or fall back accurately |

The test corpus must include realistic token/header/userinfo patterns, URL
encoding, split/chunked output, nested error causes, and redaction after string
concatenation. Assertions search all durable fixture output and serialized
status/evidence, not merely a thrown message. No production source or secret
enters a fake adapter fixture.

## Topology end-to-end deterministic fixtures

Two fresh disposable local-Git fixture families are mandatory and must exercise
real Shipyard command services behind fake provider/credential/process ports,
not parallel hand-written happy-path simulations.

1. **Staged pair:** bind a development and destination repository; create only
   the development issue/PR in the fake provider; sync clean main; create a
   reviewed exact-SHA payload; make a normal destination-owned non-fork PR;
   append a second accepted/reviewed revision without force push; simulate a
   human destination merge; then resume finalization across every checkpoint.
   Prove tree equivalence, zero development-only metadata in destination,
   close-without-merge development PR/issue, exact main sync, branch cleanup,
   retained development-only tag and ledger, and each negative guard.
2. **Single repository:** bind one repository and one existing PR; certify only
   that same-repository PR at its exact accepted/reviewed head; write one
   bounded idempotent dossier/readiness record; simulate human merge; and
   resume all finalization checkpoints. Prove no second/fork PR, no PR branch
   push/create, no merge call, no metadata leak, no duplicate dossier/tag/close
   action, and the same stale/retarget/replacement/manual-recovery behavior.

Each family runs happy path, dirty/divergent baseline, named source ref,
unclassified/conflicting metadata, stale evidence/finding, stale envelope,
actor mismatch, lock contention/recovery, every external mutation interruption,
cleanup retry, source/PR/ref drift, symlink/mode/path cases, and post-write
races. Fixtures must assert no live URL/transport is reachable.

## Bounded implementation streams and handoffs

### Stream A — Release state-machine inventory and fault-injection harness

**Scope:** Implement the code-owned mutation inventory, checkpoint audit
schema, fault-injection seam, and restart assertions used by all operation
services. It consumes final #6/#7/#8 lifecycle contracts and must not redefine
their authority or invoke a live provider.

**Exclusive files:** `src/release/types.ts`, `src/release/schema.ts`,
`src/release/recovery-audit.ts`, `test/release/recovery-audit.test.ts`,
`test/release/helpers/faults.ts`, `test/release/helpers/fixtures.ts`.

**Handoff:** publishes immutable `RecoveryAudit` / `ReleaseCheckpointAudit`
snapshots and a fake-only interrupt controller. Stream B may consume them only
after Stream A documents exact API and test results in `updates/11/execution.md`.

### Stream B — Security and isolation regression suite

**Scope:** Add cross-cutting adversarial tests and minimal remediation in the
existing narrow adapters. It cannot add a generic raw process, Git, provider,
or filesystem escape hatch.

**Exclusive files:** `test/security/**`, `test/release/security-matrix.test.ts`,
`test/release/helpers/redaction-corpus.ts`, `docs/security-boundaries.md`.
Any production correction is handed to its owning slice; ownership of shared
exports/CLI/status remains serialized under Stream D.

### Stream C — Deterministic topology certification harness

**Scope:** Build the two disposable end-to-end fixtures and a machine-readable
result index against the final operation APIs. It uses fake provider/transport,
ephemeral local repositories, and no credentials/network.

**Exclusive files:** `test/release/staged-pair.e2e.test.ts`,
`test/release/single-repository.e2e.test.ts`, `test/release/fixtures/**`,
`test/release/release-index.test.ts`.

**Handoff:** publishes only bounded test receipts: command, exact candidate
SHA, fixture identity, pass/skip/fail, and no-live-transport assertion.

### Stream D — Serialized release audit, package/discovery, and runbooks

**Scope:** After A--C pass, make the single integration change that reads the
authoritative RC SHA, verifies dependency/package/skill discovery, composes the
AC/DoD evidence index, and writes focused recovery/troubleshooting guidance.
It is the only stream allowed to edit public release status, CLI/help wiring,
shared exports, package metadata, or the final evidence collector.

**Exclusive files:** `src/release/audit.ts`, `src/release/status.ts`,
`src/status/projection.ts`, `src/index.ts`, `package.json`, `README.md`,
`docs/recovery.md`, `docs/release-readiness.md`, `docs/troubleshooting.md`,
`test/release/audit.test.ts`, `test/release/package-discovery.test.ts`.

**Package/discovery proof:** `npm pack --dry-run --json` and an extracted tarball
must contain exactly the eight skills, each `SKILL.md`, `agents/openai.yaml`,
focused references, CLI/help entries, schemas, and no private profile, token,
ledger fixture, cache, lock, or unintended duplicate skill. Fresh Codex
discovery tests use the packed artifact and focused references; they must not
claim Claude/Cursor support. Required receipts are Matt skills
`2ab958093e83e0ec752e6c1c5932da465bf23e0c`, maintained CCPM
`cdb97474904ab2cdc7d391aa17393b444a28be3e`, and Codex CLI `0.144.4`.

## Exact-SHA release acceptance protocol

1. Select a clean integrated RC SHA only after all prerequisite issues have
   accepted evidence and review. Capture `git rev-parse HEAD`, common-directory
   binding, product-tree SHA, dependency receipts, and clean status.
2. Run typecheck, full deterministic suite, both topology E2E suites, security
   matrix, package dry run/extraction/discovery checks, and static no-live-call
   assertions. Record commands, versions, results, UTC verifier identity, and
   exact RC SHA in immutable ledger evidence. A skip is allowed only when named
   as an external-gate skip, never as a pass.
3. Produce all 23 AC and 12 DoD records from code-owned manifests. Each record
   names the RC SHA, state, verifier/time, immutable evidence references, and
   any eligibility justification. No criterion may be silently inherited from
   a prior issue SHA.
4. Start a fresh independent ephemeral Codex reviewer using the reviewer-only
   envelope. It receives the RC SHA, release manifest, test/package receipts,
   and prior finding history; it cannot load implementation chatter. Accepted
   findings block. A repair changes the SHA and repeats steps 1--4.
5. The release audit returns `release-ready` only when every AC/DOD is `pass`
   or explicitly eligible justified `not-applicable`, no item is stale/blocked,
   deterministic results pass, the private fixture passes, and the independent
   review is fresh. With the private fixture unapproved, it may return only
   `deterministic-ready-external-gate-pending` and the initial PR must say so.

The AC evidence index must map all AC-001..AC-023 to one or more exact test
receipts; the DoD index must separately map DOD-001..DOD-012. In particular,
DOD-004 and the private-fixture portions of #4/#7/#8 are **pending external
gate** until an authorized fixture run succeeds. DOD-006 and DOD-010 therefore
cannot be marked complete, and `release-ready` is prohibited, while that gate
is absent. Deterministic success is still sufficient to open and review the
initial product PR, labeled accurately as non-release-ready.

## Completion evidence and independent handoff

Before #11 can be accepted, record an exact integrated RC SHA; clean worktree;
all command results; all AC/DOD index entries; security/redaction corpus result;
two topology receipts; package/extracted discovery receipts; dependency matrix;
external-fixture authorization/result or explicit pending gate; reviewer
process-isolation and result; accepted-finding dispositions; and links to every
recovery/troubleshooting runbook. The final reviewer must independently inspect
the release manifest, tests, tarball, status, and a fresh checkout; a status
projection, task checkbox, or self-authored evidence is not sufficient.

An initial PR may be opened after deterministic-ready evidence and review, but
must retain the external-gate blocker in its description and must not close
#11, claim release completion, merge, push a destination payload, or alter
NativeInteractive/Just Games. The human owner chooses whether and when to
authorize a private synthetic fixture separately.
