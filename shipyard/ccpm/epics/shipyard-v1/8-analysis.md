---
issue: 8
title: Deliver single-repository certification and finalization
analyzed: 2026-08-04T00:00:00Z
product_head_inspected: 3fd4858fbb007233cc93ad6fb93282d55fa11cad
depends_on: [3, 4, 6, 7]
status: planned-blocked-on-issues-6-and-7
estimated_hours: 28-40
parallelization_factor: 1.25
---

# Parallel Work Analysis: Issue #8

## Scope, authority, and blocking frontier

This is a local planning record for the single-repository delivery slice. It
does not authorize implementation, a GitHub mutation, a live-fixture run,
remote Git transport, a push, or use of `NativeInteractive`. The inspected
product baseline is `3fd4858fbb007233cc93ad6fb93282d55fa11cad`, the accepted
Issue #5 SHA. Issue #3 supplies the isolated ledger/workspace and context
rules; Issue #4 supplies deterministic command-scoped provider authority but
has an empty live-repository allowlist and an explicitly pending private-fixture
gate; Issue #5 supplies the narrow path classifier, clean observation, lock,
and provenance boundary.

No mergeable #8 stream may start until both of these prerequisites are accepted
and integrated at one product SHA:

1. Issue #6's canonical freshness/evidence/reviewer authority, including its
   non-forgeable exact-SHA decision and accepted-finding renewal rule.
2. Issue #7's shared topology dispatcher and immutable manifest/checkpoint
   APIs, including its canonical mutation lock and final-ledger-seal handoff.

The current branch, a task checkbox, CCPM state, GitHub review state, a raw PR
URL/number, a caller-provided SHA/ledger/manifest/profile/actor/classification,
and any prototype result are non-authoritative presentation inputs. #8 must
derive its bound single-repository topology, canonical current PR, current
product head, policy receipt, evidence decision, ledger paths, lock scope, and
provider capability internally. It must expose only detached serializable
status snapshots.

The existing PR is the sole delivery PR. Certification may attach or update a
sanitized, idempotent review dossier and mark that same PR ready when all gates
pass; it must never create, replace, fork, retarget, merge, or emulate a second
PR. Human/team merge is an observed external event, not a provider capability
Shipyard can invoke.

## Required invariants

1. **Exact single-repository binding.** Resolve one bound repository by Git
   common directory and one command-scoped `visualjc` actor. Revalidate the
   actor, repository identity, topology, branch/ref observations, path policy,
   and lock immediately before every mutable step. Never change global `gh`
   state; never accept `NativeInteractive`, an ambient credential helper, or a
   caller-selected target as authority.
2. **Fresh PR-head certification.** Under the shared mutation lock, read the
   existing PR and require same repository for base and head, expected base and
   delivery branch, open/draft-ready state allowed by the state machine, and a
   head SHA exactly equal to the newly observed local product SHA and #6's
   complete fresh acceptance/review decision. Changed SHA, incomplete evidence,
   accepted finding, wrong/replaced/retargeted/cross-repository PR, stale
   observation, or ambiguity blocks before dossier/ready mutation.
3. **Path and metadata policy.** Reclassify the exact PR-head delta and
   resulting tree immediately before certification and again before
   finalization. Prohibited metadata, source/proof/ledger refs, context
   overlays, secrets, locks, scratch/cache paths, unclassified paths, or
   conflicting ownership block. A dossier is a provider presentation artifact,
   not product cargo; it must be bounded, sanitized, idempotent, and contain no
   token, internal ledger body, unsafe path, or implementation-only context.
4. **One PR, no automatic merge.** The only provider writes are to a known
   canonical existing PR's review dossier/readiness fields and are guarded by
   an invocation-owned idempotency marker plus post-write reconciliation. No
   issue creation, PR creation, PR branch push, merge endpoint, fork workflow,
   or destination-pair operation exists in this topology.
5. **Shared manifest and checkpoints.** Reuse #7's immutable delivery manifest
   and lifecycle/checkpoint model rather than inventing parallel records. Pin
   PR identity, exact head/tree/base, policy receipt, #6 evidence/review pins,
   dossier marker/version, actor, and observation time. Use expected-head CAS
   transactions; re-read the resulting ledger SHA after each write. A retry
   validates the same record rather than duplicating a dossier/update.
6. **Human merge and exact post-merge observation.** Finalization starts only
   after the canonical existing PR is externally observed as merged at the
   expected accepted/reviewed head and expected base/topology. Closed-unmerged,
   merged wrong-head, replaced/reopened/retargeted PR, main drift, changed path
   receipt, stale evidence, or ambiguous provider response returns a blocker
   and precise next safe action. Shipyard never reports complete early.
7. **Resumable archive and cleanup.** After verified merge, serialize exact
   checkpoints for final ledger record/seal, development-only annotated reviewed
   tag, authoritative-main verification/synchronization required by the shared
   dispatcher, tracked issue closure only when the single-repository profile
   owns it, and deletion only of the proven delivery branch. Each retry either
   proves the exact invocation-owned step or stops; it never repeats a mutation,
   deletes a replaced branch/resource, overwrites a human update, or places a
   tag/ledger record in product payload/history.
8. **Truthful external evidence.** Deterministic disposable Git and fake
   provider coverage is required. The live private fixture is not approved:
   its allowlist remains empty, the retired staged fixture is forbidden, and no
   result may imply a live run occurred. A future live probe is a separate
   reviewed authorization with a code-owned allowlist.

## Target boundary

The authority boundary should be equivalent to:

```text
TrustedSingleRepositoryDeliveryOperation
  certifyExistingPr({ deliveryId }) -> SingleRepositoryStatus
  observeAndFinalize({ deliveryId }) -> SingleRepositoryStatus
```

Its factory receives trusted bound-profile/delivery resolution, #6's freshness
gate, #5's policy/classifier/observation services, #7's dispatcher/manifest/
checkpoint/seal APIs, one canonical shared lock, scoped provider transport,
and narrow Git adapters. Public callers supply only `deliveryId`; no raw
authority, decision, PR, ref, path receipt, actor, or checkpoint input crosses
the boundary.

## Bounded streams

### Stream A — Pure certification state and shared-manifest projection

**Scope.** Define single-repository-specific immutable certification and
finalization projections using #7's shared manifest/checkpoint types. Implement
pure validators and lifecycle decisions only; no filesystem, Git, provider,
ledger, lock, or process calls.

**Exclusive files.**

- `src/single-repository/types.ts`
- `src/single-repository/errors.ts`
- `src/single-repository/schema.ts`
- `src/single-repository/lifecycle.ts`
- `src/single-repository/dossier.ts`
- `test/single-repository/schema.test.ts`
- `test/single-repository/lifecycle.test.ts`
- `test/single-repository/dossier.test.ts`

**Consumes.** Settled #6 evidence decision/pins and #7 manifest, dispatcher,
checkpoint, seal, and topology abstractions. It must not redefine them or edit
their owners.

**Publishes.** Strict schemas for canonical PR observation, certification
receipt, dossier marker/body model, merged-head observation, and safe status
phase/next action. Validators reject unknown keys, hostile accessors/proxies,
malformed IDs/refs/SHAs/URLs, fork/cross-repository fields, non-identical PR
and evidence head SHAs, stale policy/evidence pins, forbidden dossier material,
illegal phase regressions, and duplicate/replayed checkpoint records.

**Adversarial tests.** Table tests cover a changed head between read and write,
different base/head repository, retarget/replacement/reopen, draft/ready
idempotence, duplicate marker, unbounded dossier, token-like strings, ledger
or source references, every prohibited/unclassified/dual-owned path receipt,
closed-unmerged, wrong merge SHA, and every finalization interruption point.

### Stream B — Locked existing-PR certification executor

**Scope.** Implement the one operation that internally resolves authority,
acquires #7's shared lock, reads current product/PR/tree facts, invokes #6
freshness, revalidates #5 path policy, persists the manifest checkpoint using
CAS, and then idempotently updates the one existing PR dossier/readiness field.
It neither creates a PR/issue/branch nor merges/pushes a branch.

**Exclusive files.**

- `src/single-repository/authority.ts`
- `src/single-repository/certify.ts`
- `src/single-repository/ledger.ts`
- `src/single-repository/status.ts`
- `src/adapters/single-repository-pr.ts`
- `test/single-repository/certify.test.ts`
- `test/single-repository/ledger.test.ts`
- `test/adapters/single-repository-pr.test.ts`
- `test/integration/single-repository-certification/**`

**Can start.** Only after A is committed and #6/#7 are accepted/integrated at
one pinned SHA. It reads the accepted seams only; it must not alter #3 context,
#4 generic tracker, #5 sync/classifier, #6 evidence, #7 dispatcher/manifest,
or public CLI ownership.

**Adversarial tests.** Disposable local Git plus fake REST tests prove no write
before every gate, single canonical PR selection, command-scoped actor
preflight/redaction, lock/CAS/reread races, interrupted write/retry discovery,
post-write response mismatch, no duplicate dossier/update, blocked mutation on
every unsafe PR or path state, and no call to create/merge/issue/fork/push
operations. Assert global `gh` fingerprint and remote configuration are
unchanged and no `NativeInteractive`/live endpoint is reachable.

### Stream C — Serialized post-human-merge finalization and recovery docs

**Scope.** Consume B's canonical certification receipt and #7's common
finalization dispatcher to observe a human merge and execute only the
single-repository-valid archive/tag/main-verification/tracked-record/branch
cleanup checkpoints. Add focused single-repository operation and recovery
documentation. It must not infer staged-pair development PR cleanup where no
separate PR exists.

**Exclusive files.**

- `src/single-repository/finalize.ts`
- `src/single-repository/finalization-status.ts`
- `src/adapters/single-repository-finalization-git.ts`
- `docs/single-repository.md`
- `docs/single-repository-recovery.md`
- `test/single-repository/finalize.test.ts`
- `test/integration/single-repository-finalization/**`

**Can start.** Only after B's exact checkpoint/PR handoff is integrated.
Finalization is serialized after certification; no concurrent stream designs or
mutates this lifecycle.

**Adversarial tests.** Fake-provider/disposable-Git matrices inject failure
before and after each ledger record/seal, tag, main observation/sync, issue
closure (where owned), and delivery-branch deletion. Reruns must prove the
same checkpoint or block. Cases cover closed-unmerged, wrong/replaced PR,
wrong merged head/base/tree, main drift, stale evidence/policy, tag mismatch,
ledger/tag leakage, branch replacement, lock/CAS races, and human changes
between observation and cleanup. Assert no merge endpoint/command is present.

### Stream D — Serialized public/status handoff and exact-SHA acceptance

**Scope.** After A–C pass, one integrator wires only settled internal APIs into
the #9-owned future public orchestration handoff (or records a typed internal
handoff if #9 has not started), contributes the accepted status facts without
changing the #2 status schema, runs the full suite/package checks, creates
current-SHA acceptance evidence, and obtains a fresh independent reviewer.

**Exclusive files.**

- `test/integration/single-repository-public-handoff/**`
- `docs/recovery.md` (single serialized additive handoff only)
- `src/index.ts` (only if its established owner explicitly performs the final
  export handoff after an API inventory)

No stream edits `src/cli/**`, `src/commands/**`, public skill directories,
`src/status/projection.ts`, `src/binding/**`, `src/profile/**`, `src/context/**`,
`src/ledger/**`, `src/github/**`, `src/sync/**`, or #6/#7-owned modules. Task
#9 owns broad CLI/skill dispatch; #8 supplies a narrow typed operation/status
contributor and a written handoff, not duplicate command definitions.

**Acceptance procedure.** At the final integrated SHA, record exact commands,
test/package receipts, deterministic fixture results, verifier/time, #6
freshness result, #7 manifest/dispatcher pins, and a separate high-capability
review. Any product change invalidates acceptance/review and restarts this
step. Evidence must explicitly say that private live synthetic coverage was
skipped because no code-owned approved repository/actor exists.

## Ordering and handoffs

1. Wait for #6 acceptance/review/integration and #7 completed shared
   manifest/dispatcher APIs. Pin their exact product SHA and compatibility
   inventory in the #8 integration record.
2. Implement A, review its pure contract, then hand its schema inventory to B.
3. Implement B and pass deterministic certification/race tests. Integrate it
   once against the pinned #6/#7 seams; do not touch public command surfaces.
4. Implement C only from B's integrated canonical receipt. Run all interruption
   and no-merge matrices.
5. Serialize D: resolve any shared handoff through the owning task, run full
   verification, regenerate exact-SHA evidence, then commission an independent
   reviewer. No checkbox, issue state, remote push, or live fixture is a
   substitute for that evidence.

## Acceptance mapping

| Requirement | Proof required from #8 |
| --- | --- |
| PRD AC-016 human merge boundary | Existing PR is certified but never merged; completion stays blocked until exact external merged-head observation; wrong/closed/replaced states block. |
| PRD AC-018 single-repository flow | Exactly one same-repository PR is selected/updated; its exact accepted/reviewed head and path policy are proven; no create/fork/second PR/merge route exists. |
| PRD AC-019 resumability | Every certification/finalization mutation has immutable marker/checkpoint, post-write reconciliation, and interruption/retry tests. |
| Task acceptance and DoD | Local Git/fake-provider coverage, docs, exact integrated SHA evidence, and independent review with no unresolved accepted finding. |

## External boundary

This issue must never mutate a real GitHub resource during implementation or
acceptance. It must not use the previously exercised `visualjc/shipyard-fixture-staged`,
any `NativeInteractive` repository, or any Just Games resource. The empty
code-owned live allowlist keeps the private live fixture skipped. A later
explicitly authorized, reviewed live probe must be planned and evidenced
separately; it is not a condition this plan may pretend to satisfy.
