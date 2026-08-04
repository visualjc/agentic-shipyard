---
issue: 4
title: Deliver scoped GitHub tracking authority
analyzed: 2026-08-03T23:55:00Z
estimated_hours: 32
parallelization_factor: 1.5
status: ready-for-execution
---

# Parallel Work Analysis: Issue #4

## Overview

Issue #4 adds the first external-mutation boundary after the completed Issue
#2 foundation (`bba2e5e083ea460deba92ffa686b986b8102067f`).  That foundation
already validates a bound profile/topology, pins the profile fingerprint,
contains the configured `actor.login`, and exposes a generic `providerRefs`
status field.  This issue must consume those facts; it must not infer an actor
from `gh`, a remote URL, or a process-global credential.

The provider slice is intentionally independent of Issue #3.  It returns
opaque, serializable provider checkpoints for a future delivery/ledger owner
to persist, but creates no delivery, worktree, ledger branch, envelope, or
ledger record.  All tests use injected REST/command/credential fakes and
private-fixture opt-in gates; they never invoke `gh auth switch`, mutate
`NativeInteractive`, or rely on the machine's active `gh` account.

This analysis is a planning record only.  No implementation, acceptance, or
review status is implied by it.

## Parallel Streams

### Stream A: Scoped GitHub REST authority

**Scope**: Define the narrow GitHub REST adapter and API-credential port;
verify `/user` against the profile's configured actor before any write; make
authenticated requests with an ephemeral authorization value; and expose only
sanitized, actionable auth/permission/transport failures.

**Files**:

- `src/adapters/github-rest.ts` (exclusive owner)
- `src/github/authority.ts` (exclusive owner)
- `src/github/errors.ts` (exclusive owner)
- `src/github/types.ts` (exclusive owner)
- `test/github/authority.test.ts` (exclusive owner)
- `test/github/rest-adapter.test.ts` (exclusive owner)

**Can Start**: immediately.

**Estimated Hours**: 10–12.

**Dependencies**: Issue #2 profile/binding contracts only.  The adapter takes
an injected credential resolver; it does not read a token from a profile,
shell, `gh`, or persistent Shipyard state.  It does not edit `src/index.ts` or
the shared status projection.

**Verification Responsibility**: Deterministic fake-REST tests prove viewer
verification precedes every mutation, unexpected/missing actor and denied
permission make zero writes, HTTP failures do not expose authorization values,
and no adapter path invokes or changes global `gh` identity.  A separately
named opt-in private-fixture test may run only against an approved disposable
development repository; it is skipped by default and has no NativeInteractive
configuration path.

### Stream B: Development issue/PR tracker and resume projection

**Scope**: Build stable Shipyard marker generation, strict development-repo
selection from the bound topology, idempotent discovery/create flows for one
development issue and one development PR, and typed provider checkpoints and
status contribution.  A checkpoint contains exact GitHub node/number IDs,
URLs, expected head SHA, marker, and discovery/create state; its persistence is
explicitly delegated to Issue #3 or its caller.

**Files**:

- `src/github/markers.ts` (exclusive owner)
- `src/github/tracker.ts` (exclusive owner)
- `src/github/status.ts` (exclusive owner)
- `test/github/tracker.test.ts` (exclusive owner)
- `test/github/status.test.ts` (exclusive owner)
- `test/helpers/github.ts` (exclusive owner)

**Can Start**: after Stream A publishes its adapter/types/error inventory.

**Estimated Hours**: 12–14.

**Dependencies**: Stream A's verified authority/session and the Issue #2
`Profile`/`Topology` types.  It may consume the existing generic
`StatusContributor` and `providerRefs`, but must not modify
`src/status/projection.ts`.  It must not edit delivery/ledger/context modules
or claim ownership of checkpoint storage.

**Verification Responsibility**: Table-driven fake-provider tests prove
staged-pair writes address only `topology.development`; a destination issue or
PR attempt is rejected before REST mutation; single-repository writes use its
only bound repository; stable marker plus exact provider ID resume discovers
instead of duplicates; ambiguous/mismatched marker records block; returned PR
head equals the requested expected head SHA; and status exposes actor,
permission/record state, blockers, and a safe next action without a write.

### Stream C: Scoped authenticated Git transport and recovery documentation

**Scope**: Define the separate Git-transport credential and command-runner
boundary.  Run authenticated Git with inherited credential helpers disabled,
token material supplied only through an ephemeral environment, and redacted
diagnostics.  Document credential separation, safe recovery/resume states,
and the opt-in synthetic-fixture procedure.

**Files**:

- `src/adapters/git-transport.ts` (exclusive owner)
- `src/github/git-transport.ts` (exclusive owner)
- `docs/credentials.md` (exclusive owner)
- `docs/github-tracking-recovery.md` (exclusive owner)
- `test/github/git-transport.test.ts` (exclusive owner)
- `test/github/credential-redaction.test.ts` (exclusive owner)

**Can Start**: immediately; it uses its own credential type and does not
depend on Stream A's API credential shape.

**Estimated Hours**: 8–10.

**Dependencies**: Issue #2 only.  Task #5 later consumes this transport
boundary for sync; it is not permitted to extend `src/adapters/git.ts`, add a
sync command, change remotes, or persist transport credentials.

**Verification Responsibility**: Fake command-runner tests inspect the exact
argv and environment contract: `credential.helper=` is disabled, credentials
are not in argv/remotes/output/errors, inherited helper configuration cannot
win, and all success/failure paths leave the global `gh` state untouched.  The
tests are deterministic and run without network or a real GitHub identity.

## Acceptance and Definition-of-Done Mapping

| Requirement | Implementing stream | Verification owner and evidence |
| --- | --- | --- |
| Issue AC / PRD AC-003: configured actor is verified before a write; unexpected login rejects | A | A: ordered fake-REST call trace (`GET /user` before any mutation), mismatch/no-write and sanitized-error tests |
| Issue AC: global active `gh` account unchanged | A, C | A/C: no-`gh` adapter/runner contract tests; private fixture captures `gh auth status` only before/after when explicitly enabled, never switches identity |
| Issue AC / PRD AC-004: authenticated Git disables inherited helpers and uses an ephemeral token without persistence/logging | C | C: argv/environment, no-token-in-remote/log/error, and inherited-helper negative tests |
| Issue AC / PRD AC-007: issue and development-PR writes target only configured development repo; destination workflow issue is prohibited | B using A | B: staged-pair and single-repository request-target matrix plus pre-write destination rejection |
| Issue AC: REST mutations are resumable and idempotently discover Shipyard-created records | B using A | B: repeat, interrupted-after-create, exact-ID, marker discovery, ambiguity, and stale/mismatched-record matrix |
| Issue AC: stable IDs, URLs, expected head SHA, and resume checkpoints for later ledger/status integration | B | B: typed checkpoint fixtures and provider-status contributor tests; no persistence side effect |
| Issue AC: actionable auth/permission errors without token echo | A, C | A/C: redaction corpus tests for thrown error, request diagnostic, command output, and documentation examples |
| Issue technical detail: provider identity, permission, record, blocker fields contribute to shared status | B | B: contributor composes through existing `StatusProjection` without changing its owner module |
| DoD: code behind a GitHub adapter interface | A | A: compile-only consumer fixture uses the interface/fake rather than concrete network implementation |
| DoD: unit, negative-auth, redaction, private-fixture tests | A/B/C | Each stream runs deterministic suite; C owns opt-in fixture instructions and default skip proof |
| DoD: credential/tracker documentation and recovery states | C (credentials/recovery), B (record semantics supplied) | C: focused-document link/check examples; B: checkpoint state table reviewed during integration |
| DoD: exact product SHA and verifier in acceptance evidence | Integration owner after streams | Create evidence only against the final integrated SHA; no stream self-certifies acceptance |
| DoD: no unresolved independent-review finding | Independent reviewer after integration | Separate reviewer receives issue intent, final SHA, tests, and redaction/fixture evidence |

The explicit implementation-test targets are AC-003, AC-004, AC-007, and the
provider-specific portion of AC-019.  They are not release-wide claims that
the full lifecycle criteria have passed.

## Coordination Points

| Shared surface | Owner / rule |
| --- | --- |
| `src/contracts/**`, `src/profile/**`, binding validation and locks | Completed Issue #2 contracts are read-only inputs.  Task #4 must not revise them to fit provider implementation. |
| `src/status/projection.ts` | Issue #2 remains sole owner. Stream B supplies a contributor using existing `providerRefs`/`blockers`; no shared-shape edit is required. |
| `src/index.ts` | Preserve the completed public-barrel owner. A post-stream integration handoff may add reviewed provider exports only after all stream APIs settle; no stream edits it. |
| `src/adapters/git.ts` | Preserve Issue #2's identity-only adapter. Stream C adds a separate transport adapter; task #5 consumes it later. |
| Issue #3 delivery/ledger/context/workspace trees | Explicitly out of scope. The sole integration object is B's serializable checkpoint/status contributor; Issue #3 decides if and when it persists it. |
| CLI, public skills, command wiring | No owner in this issue. Later orchestration work connects mutation entry points after binding, locking, and delivery lifecycle are available. |

## Sequential Requirements

1. Start Streams A and C in parallel.
2. Stream A publishes the REST-interface, verified-session, and safe-error
   inventory; Stream B then implements tracker semantics against a fake.
3. Integrate A, B, and C without changing Issue #3-owned files.  Add public
   exports only through the recorded `src/index.ts` handoff, if a consumer is
   ready.
4. Run the aggregate deterministic suite, then an independent review against
   the exact integrated SHA.  An approved operator may separately run the
   documented private synthetic fixture; it is evidence, not a prerequisite
   for unit-test determinism.

## Conflict Risk Assessment

Risk is low because new `src/github/**`, `test/github/**`, and transport
adapter paths are exclusively owned.  The only planned integration seams are
the completed Issue #2 public/status contracts and the future Issue #3
checkpoint consumer.  No stream may edit an Issue #3 file (`src/delivery/**`,
`src/ledger/**`, `src/context/**`, workspace creation, or its tests), even if
that implementation appears first in the shared worktree.

## Expected Timeline

- Streams A and C in parallel: 10–12 wall-clock hours.
- Stream B and integration: 12–14 additional hours.
- Expected total before independent review: 22–26 wall-clock hours; 30–36
  engineering hours including fixture documentation and review remediation.
