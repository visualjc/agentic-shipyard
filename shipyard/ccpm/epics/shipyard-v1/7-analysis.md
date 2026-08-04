---
issue: 7
title: Deliver staged-pair promotion and finalization
analyzed: 2026-08-04T00:00:00Z
product_head_inspected: 3fd4858fbb007233cc93ad6fb93282d55fa11cad
depends_on: [3, 4, 5, 6]
status: planned-blocked-on-issue-6
estimated_hours: 40-52
parallelization_factor: 1.35
---

# Parallel Work Analysis: Issue #7

## Grounding, scope, and non-authorities

This is a plan for the staged-pair slice only.  It is not an implementation,
acceptance result, or permission to contact a live repository.  It is grounded
in task #7, the Shipyard v1 PRD (FR-008 and FR-014 through FR-018; AC-011,
AC-012, AC-013, AC-016, and AC-017), the resolved Wayfinder promotion decision,
and the local/GitHub lifecycle prototypes.

The inspected product head is
`3fd4858fbb007233cc93ad6fb93282d55fa11cad`, the accepted Issue #5 sync SHA.
Issue #3 supplies binding, delivery/worktree identity, isolated ledger and
role-envelope rules.  Issue #4 supplies command-scoped GitHub authority and
development-only tracking, but its private live-fixture gate remains explicitly
unapproved.  Issue #5 supplies the locked clean-baseline/source-import
boundary, one-owner classifier, provenance, and no-writable-destination-remote
discipline.  Issue #6 is the pending owner of the canonical exact-SHA evidence
and independent-review authority.  Its current worktree is useful only as an
API forecast; it is not accepted or integrated.

Therefore no Issue #7 implementation stream may start until the final Issue
#6 authority APIs pass independent review and are integrated at one exact
product SHA.  #7 consumes that final API through a narrow authority-created
operation.  It must not accept caller-provided `promotionEligible`, raw ledger
bytes/heads, reviewer result, product SHA, current destination ref, profile,
actor, manifest, GitHub record, or path classification as an authority.  Task
checkboxes, CCPM status, GitHub approvals, the current draft PR, and prototype
success are presentation or planning facts, never an alternative gate.

This slice may use deterministic disposable local Git fixtures and fake
provider/transport adapters.  It must not create/update/delete a GitHub
resource, invoke an authenticated live Git transport, use `NativeInteractive`,
or reuse/rename/delete the retired `shipyard-fixture-staged` private fixture.
There is no live-fixture claim in #7 acceptance evidence.  Any future live
probe requires a separately reviewed, code-owned approved repository/actor
allowlist and is outside this task's deterministic implementation.

## Invariants the implementation must preserve

1. **Authority and actor.** Every external-capable operation derives the bound
   staged-pair topology and command-scoped `visualjc` authority internally,
   revalidates it immediately before a mutation, and never changes ambient
   `gh` configuration.  It rejects every other actor, every `NativeInteractive`
   workflow write, a destination issue, a fork/cross-repository PR, and a
   retained writable destination remote in a development clone.  Git transport
   uses the existing scoped credential boundary with inherited helpers disabled;
   no token may enter a remote URL, argv, logs, errors, ledger, or payload.
2. **Exact gates.** Initial promotion and each revision require a newly read
   current development product SHA plus #6's complete fresh acceptance and
   independent-review decision for that exact SHA.  A SHA change, accepted
   finding, incomplete record, mismatched review, stale binding, stale
   destination observation, or disputed evidence blocks before the first
   destination/provider write.  Finalization rechecks the final promoted
   revision's exact development SHA and its mapped destination commit.
3. **Clean destination baseline.** Initial promotion begins only after #5's
   clean/non-divergent authoritative destination `main` observation is current.
   The destination branch is created from that exact main and remains
   destination-owned.  Revisions and finalization re-fetch/re-observe all
   involved refs and provider record state under the shared mutation lock.
   Shipyard never repairs drift with merge/rebase/reset and never force-pushes
   an active destination branch.
4. **Git-native sanitized cargo.** Construct initial and revision commits from
   Git trees/indexes, not checkout/copy logic.  Preserve regular files,
   executable modes, symlinks, binary contents, renames, deletions, unusual
   paths, submodule/gitlink behavior if policy permits it, and all path
   operations.  Revalidate one-owner classification immediately before every
   payload construction and before finalization.  Development records, ledger
   artifacts, source/proof refs, context overlays, secrets, locks, scratch,
   caches, and every unclassified or multiply owned path are rejected from the
   destination tree.
5. **Append-only destination history.** An initial accepted source SHA maps to
   exactly one sanitized destination commit.  A later accepted source SHA maps
   to exactly one descendant delta commit appended to the existing destination
   PR branch, after checking the remote head is the recorded head.  Retry may
   discover and validate an already-created Shipyard record but may never
   silently recreate a different commit, amend, force-push, or append twice.
6. **Manifest and ledger.** The development-only ledger receives immutable,
   compare-and-swap checkpoint records and a promotion manifest mapping each
   reviewed development SHA to destination branch/commit/tree, baseline,
   provider PR identity/URL, actor, path-policy receipt, and exact pinned
   evidence/review references.  Tree equivalence compares Git-native trees for
   each mapping.  The ledger remains outside product ancestry and is never
   copied to or named in destination payloads.  A final seal follows the
   existing final-ledger-seal model: contents name the previous checkpoint;
   the following seal/ref observation proves the resulting ledger SHA.
7. **Human merge boundary.** No command calls a merge endpoint or reports a
   delivery complete merely because a PR is approved/closed.  Finalization
   observes a merged destination-owned PR and verifies its expected final
   destination head/topology before its first mutable step.  A closed-unmerged,
   replaced, retargeted, cross-repo, wrong-head, or ambiguous PR remains a
   blocker with a safe next action.
8. **Checkpointed, compensation-aware finalization.** Every mutable external
   step has a durable idempotency key/checkpoint and exact-state resume test:
   final ledger checkpoint/seal, development-only annotated tag, exact
   destination-main to development-main synchronization, development PR close
   **without merge**, development issue close, and delivery-branch cleanup.
   A failure after any step does not repeat an unsafe mutation or delete an
   unobserved/replaced resource.  It returns the checkpointed next action;
   compensation is limited to a mutation created and proven by this invocation
   and never erases a later human/user change.

## Target public shape and ownership boundary

Issue #7 should create a small staged-delivery domain rather than expose a
generic raw Git or GitHub promotion primitive.  Names can change during
implementation, but the authority boundary must remain equivalent to:

```text
TrustedStagedPromotionOperation
  promoteInitial({ deliveryId }) -> PromotionStatus
  appendRevision({ deliveryId }) -> PromotionStatus

TrustedStagedFinalizationOperation
  observeAndFinalize({ deliveryId }) -> FinalizationStatus
```

Both factories receive code-owned bound-profile/delivery resolution, #6's
trusted freshness gate, #5's narrow sync/Git policy service, classifier,
shared mutation lock, ledger store, scoped Git transport, and a destination PR
adapter.  They derive source SHA, refs, actor, allowed paths, PR records, and
checkpoint paths themselves.  They accept no caller-supplied authority
objects.  Public status types are detached serializable snapshots with safe
IDs/URLs/ref observations, blockers, phase, and next action only.

The destination-provider port is deliberately narrow: find/create/update the
normal **destination-owned** PR, read its exact head/base/merged state, and
close only a known development PR/issue through the existing development
tracker authority during finalization.  It must carry idempotency markers and
reject a destination issue operation by type, not by documentation.  A later
task owns broad CLI/skill orchestration; #7 may add the narrow internal command
service and test-only adapter contracts necessary for its own lifecycle, but
must not take ownership of unrelated public command dispatch.

## Parallel streams

### Stream A — Pure staged payload, manifest, and lifecycle-state authority

**Scope.** Define the canonical staged-pair domain: initial/revision/finalize
state machine, immutable manifest/checkpoint schemas, Git-tree payload plan,
tree-equivalence algorithm contract, idempotency keys, and pure transition
decisions.  This stream has no filesystem, Git process, credential, network,
ledger write, lock acquisition, or provider call.

**Exclusive files.**

- `src/promotion/types.ts`
- `src/promotion/errors.ts`
- `src/promotion/schema.ts`
- `src/promotion/payload.ts`
- `src/promotion/manifest.ts`
- `src/promotion/lifecycle.ts`
- `test/promotion/schema.test.ts`
- `test/promotion/payload.test.ts`
- `test/promotion/lifecycle.test.ts`
- `test/promotion/fixtures/**`

**Publishes.** Canonical `PromotionManifest`, `PromotionMapping`,
`PromotionCheckpoint`, `FinalizationCheckpoint`, `PayloadPlan`,
`TreeEquivalenceReceipt`, lifecycle phase/next-action types, validators, and
pure decisions.  A mapping includes exact development SHA, destination commit
and tree SHA, expected parent/branch/base, classifier/policy receipt, evidence
decision pins, and PR identity.  It rejects duplicate source/destination
mappings, non-descendant revisions, forbidden refs/paths, unknown keys,
incompatible object IDs, and illegal phase regressions.

**Can start.** Only after #6 has published and integrated its settled freshness
decision contract, because the schema must pin its exact decision/evidence
references.  It may be developed against a compile-only provisional interface
in a disposable branch before then, but no mergeable implementation begins.

**Verification.** Table-driven tests cover canonicalization, hostile accessors
and proxies, duplicate/reordered/replayed checkpoint data, stale/different
SHA, malformed object/path/ref names, initial versus revision ancestry,
non-descendant/duplicate append, human-merge preconditions, each interruption
point, safe resume, and no input field that can forge freshness or actor
authority.  Payload tests model binary blobs, executable bit changes, symlinks,
renames, deletions, unusual paths, gitlinks, prohibited metadata, scratch,
source-ref/proof leakage, unclassified and dual-owned paths.

### Stream B — Git-native local staged delivery executor

**Scope.** Implement the sole local Git/index executor that derives its bound
authority, takes the shared mutation lock, revalidates source/destination
observations, obtains #6 freshness internally, applies Stream A's exact
payload plan to a destination-owned local branch, verifies resulting trees,
and writes/re-reads ledger checkpoints with CAS.  It supports initial creation
and one append-only revision; it does not create a provider PR, merge, close
an issue, tag, or delete branches.

**Exclusive files.**

- `src/promotion/git-executor.ts`
- `src/promotion/authority.ts`
- `src/promotion/ledger.ts`
- `src/promotion/status.ts`
- `src/adapters/staged-git.ts`
- `test/promotion/git-executor.test.ts`
- `test/promotion/ledger.test.ts`
- `test/promotion/helpers/disposable-staged-pair.ts`
- `test/integration/staged-payload/**`

**Consumes.** Stream A contracts; the accepted #3 delivery/context/ledger
seams; #5 bound sync/provenance/path-classifier/mutation-lock seams; and the
final integrated #6 trusted evidence gate.  It must use their narrow APIs;
it may not edit their owner modules or use raw Node child-process Git publicly.

**Can start.** After A's contract and final #6 integration.  It is independent
of Stream C's provider adapter but serializes its own mutation at the common
directory/canonical destination lock scope.

**Verification.** Disposable two-bare-repository tests prove initial tree
equality, exact mode/symlink/binary/rename/delete handling, source and
destination ref revalidation, clean-baseline rejection, unclassified/conflict
metadata rejection before writes, stale evidence/no provider call, CAS and
commit-time races, lock contention, failure compensation, and preserved user
edits.  Revision tests prove one descendant commit, recorded remote-head check,
no force/update of an active branch, retry discovery with exact validation,
and tree equality for each reviewed SHA.  The executor must prove destination
refspecs/payload never contain ledger/source/proof namespaces.

### Stream C — Scoped destination PR and tracked-record bridge

**Scope.** Add the narrowly scoped provider bridge required to create/find the
normal destination-owned PR after B's local commit succeeds, append the same
existing branch without fork semantics, write a concise sanitized dossier, and
observe exact destination PR state for finalization.  Reuse Issue #4's
command-scoped REST/transport authority for development records only; provide
a separate type-limited destination PR capability that cannot create a
destination workflow issue.

**Exclusive files.**

- `src/promotion/provider.ts`
- `src/promotion/provider-authority.ts`
- `src/adapters/destination-pr.ts`
- `test/promotion/provider.test.ts`
- `test/adapters/destination-pr.test.ts`
- `test/integration/staged-provider/**`

**Consumes.** Stream A's immutable records and B's post-commit/mapped-head
receipt.  It uses an injected fake REST transport in all deterministic tests.
It must not modify `src/github/tracker.ts`, generic GitHub authority, or
profile ownership merely to make destination writes easier.

**Can start.** Contract/test scaffolding after A; implementation after B has
published the exact destination branch/checkpoint handoff.  It must wait for
final #6 integration before any gate wiring.

**Verification.** Tests assert exact scoped actor preflight and redaction;
destination owner/repository is bound and non-`NativeInteractive` test fixture
only; PR `headRepository.owner == destination owner`, `baseRepository ==
destination`, `isCrossRepository == false`, expected base/head/ref/tree, and
marker/checkpoint all match before recording success.  They reject fork,
cross-repo, wrong-owner/base/head, ambiguous marker, stale remote head,
retarget/replacement, destination-issue path, malformed/non-sanitized dossier,
and any token/global-`gh` mutation.  Repeat/interruption tests prove exact
marker discovery and no duplicate PR/update.

### Stream D — Serialized finalization executor and recovery documentation

**Scope.** After A/B/C settle, implement the one serialized finalization
operation: read the immutable manifest/checkpoints; observe an externally
merged expected destination PR; revalidate all policy, exact refs, tree, actor,
and evidence facts; checkpoint/seal ledger; create/verify the annotated
development-only reviewed tag; use the narrow safe sync path to fast-forward
development main to the exact merged destination main; close the development
PR without merge; close the development issue; and delete only proven delivery
branches.  Add focused promotion/finalization/recovery documentation.

**Exclusive files.**

- `src/finalization/types.ts`
- `src/finalization/errors.ts`
- `src/finalization/service.ts`
- `src/finalization/ledger.ts`
- `src/finalization/status.ts`
- `src/adapters/finalization-git.ts`
- `docs/staged-promotion.md`
- `docs/staged-finalization.md`
- `docs/recovery.md`
- `test/finalization/service.test.ts`
- `test/finalization/ledger.test.ts`
- `test/integration/staged-finalization/**`

**Consumes.** Stream A manifest/state types, B local Git receipt, C provider
observation, #3 final-ledger-seal/ledger isolation, #4 development-only
close-record authority, #5 exact-main sync and locks, and #6 exact-SHA gate.
It owns no generic status projection or public barrel; those are deferred to
the later orchestration/release handoff unless an explicit serialized handoff
is recorded.

**Can start.** Only after B/C integration because finalization must consume the
actual canonical promotion manifest/PR checkpoint, never independently
reconstruct one.

**Verification.** Local fake-provider/disposable Git matrices simulate each
failure immediately before/after: merged-PR observation, final ledger write,
seal, tag create/push/verify, main sync, development PR close, issue close,
and each branch deletion.  Every rerun must either verify an invocation-owned
completed checkpoint or stop with a precise manual next action; none may merge,
force-push, close a replacement resource, delete an unrecognized branch, or
erase a human update.  Tests cover closed-unmerged/wrong-head/replaced PR,
destination-main drift, stale policy/evidence, tag mismatch or destination tag
leak, ledger-in-product leak, path reclassification failure, race/lock/CAS
failure, and post-sync exact-main equality.  They prove the development PR is
closed without merge and that only the development issue is closed.

## Serialized integration and handoffs

The following shared files are serialized and have one named integration owner;
no parallel stream edits them:

| Shared surface | Owner and handoff rule |
| --- | --- |
| `src/index.ts` | One post-D integrator adds only settled exports after complete API inventories and tests; no stream edits it. |
| `src/cli/**`, `src/commands/**`, public skill directories | No #7 stream owns broad wiring. Task #9 owns public orchestration. #7 may provide internal command services and focused docs only. |
| `src/status/projection.ts` | Issue #2 stays owner. B/D contribute a typed status contributor without shape changes. |
| `src/contracts/**`, `src/binding/**`, `src/profile/**`, `src/workspace/**`, `src/context/**` | Read-only accepted inputs. Any missing capability is a recorded design handoff, never a silent edit. |
| `src/ledger/**`, `src/github/**`, `src/sync/**` / #5-owned sync modules | Reuse narrow accepted APIs. #7 additions live under `promotion/` or `finalization/`; edits require the owning issue's explicit compatibility handoff. |
| manifest/checkpoint paths | A owns schema; B/C/D write only through the A validators and CAS ledger boundary. |

Recommended ordering is: final #6 API/review/integration → A contract → B
local executor and C provider scaffolding → B completion → C completion → D
finalization → serialized integration/export/status handoff → full exact-SHA
verification → fresh independent high-capability review.  B and C can overlap
only after their input/output handoff is committed and pinned.  D is never
parallel with B/C mutation design.  Any cherry-pick conflict in shared seams
is resolved by the integration owner with the conflict-resolution procedure,
not by a stream overwriting another stream's work.

## Milestone evidence and acceptance mapping

| Milestone | Gate before mutation | Required deterministic evidence |
| --- | --- | --- |
| Initial sanitized promotion | bound staged pair, clean current destination main, one-owner delta, fresh #6 decision at current dev SHA, shared lock | destination-owned non-cross-repo PR fixture; one initial commit/tree equal to reviewed product tree; manifest/ledger pins; prohibited metadata rejection (AC-011, AC-013). |
| Append-only revision | later exact reviewed dev SHA, recorded PR/remote head equals manifest, reclassified delta, fresh #6 decision, lock | exactly one descendant sanitized commit, no force push, every mapping tree equal, retry/race matrices (AC-012, AC-013). |
| Human merge observation | PR merged by fake external actor, expected merge/head/base/tree and final evidence/manifest revalidated | command cannot merge; closed-unmerged/replacement/wrong-head blockers (AC-016). |
| Resumable finalization | verified human merge plus all policy/path/ref/actor observations current | final ledger seal, development-only annotated tag, exact main sync, dev PR close-unmerged, dev issue close, branch cleanup, interruption/retry proof (AC-017). |

The issue's final exact-SHA evidence must name the final integrated product SHA,
verifier, UTC time, commands, deterministic fixture results, package receipt,
and independent-review result.  It must state that live private fixture
execution is unauthorized/skipped rather than implying it ran.  An issue/epic
checkbox may be changed only after that evidence and review exist; it cannot
authorize promotion or finalization.

## Adversarial completion matrix

Before implementation is accepted, the combined suite must demonstrate at
least: forged/caller-supplied authority; actor/repository/PR topology mismatch;
global-account preservation; token/credential redaction; stale source,
destination, binding, evidence, review, policy, ledger, and path state;
unclassified/conflicting/prohibited metadata; binary/mode/symlink/rename/delete
payload fidelity; source/proof/ledger/tag publication exclusion; CAS and
commit-time races; lock contention/recovery; process/provider failure at every
checkpoint; duplicate/ambiguous marker and replaced resource; initial/revision
retry; active-branch force/amend refusal; closed-unmerged/wrong-head/retargeted
PR; attempted automated merge; finalization crash/resume; branch/tag cleanup
ownership; exact main equality; and ledger/tag retention only in development.

`npm run typecheck`, the full deterministic test suite, focused disposable Git
integration suite, package dry-run, diff check, and clean worktree check run
against the exact final integrated SHA.  A fresh independent high-capability
reviewer receives only the stated issue intent, exact SHA, approved evidence,
and permitted reviewer context; findings are resolved only through #6's
renewed exact-SHA process.
