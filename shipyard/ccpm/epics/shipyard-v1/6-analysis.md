---
issue: 6
title: Deliver exact-SHA acceptance and Codex review
analyzed: 2026-08-04T00:00:00Z
estimated_hours: 32
parallelization_factor: 1.5
status: planned
product_head_inspected: 972cb1b75e6bca766a9489fd928e17431ad9fee1
---

# Parallel Work Analysis: Issue #6

## Grounding and boundary

This plan implements the evidence gate required by PRD AC-014 and AC-015, not
promotion, provider approval, or a general task-box workflow. The inspected
product baseline is `972cb1b75e6bca766a9489fd928e17431ad9fee1` on the clean
product worktree. Uncommitted Issue #3/#4 planning and execution records live
only in the separate ledger worktree; they are not product evidence and are
not part of this plan's candidate SHA. The completed Issue #2
record is the accepted local example of an evidence record and a separate
review record, but its checked epic box and GitHub state are explicitly not an
authority for this issue.

Issue #3 already supplies canonical role-limited context envelopes, a trusted
dispatch expectation, a product-SHA-before-ledger-read guard, and a pinned
ledger reader. In particular, its reviewer allowlist is intent, acceptance,
and review records; implementation task chatter is excluded. Issue #2 owns
the shared `StatusProjection` contract, including `acceptanceFresh`, blockers,
and next action. Issue #4's provider checkpoint is presentation data only.
This issue consumes all of those seams and must neither infer a provider
approval nor change binding, workspace, context, or GitHub authority behavior.

The immutable Shipyard acceptance authority is a canonical evidence bundle at
one exact product SHA plus a current independent review result at that same
SHA. A GitHub approval, an issue/epic checkbox, a CCPM execution state, raw
test success, or a generated `pass` field is never an alternative authority.
They may be cited as non-authoritative observations only.

## Evidence protocol and machine-validated schemas

Stream A defines version-1 canonical JSON documents. Canonical serialization
is deterministic (exact keys, stable array order, normalized UTC ISO-8601
instants, lower-case full Git object IDs, no unknown fields); schema validation
returns detached immutable values.

| Document | Required machine-validated fields | Gate meaning |
| --- | --- | --- |
| `acceptance.json` | `schemaVersion`, `issueId`, `productSha`, `items[]` | Each item has stable `id`, `kind` (`acceptance` or `definition-of-done`), `state` (`pass`, `blocked`, `not-applicable`), non-empty `evidenceRefs[]`, `verifier`, `verifiedAt`, and, for `not-applicable`, a non-empty `justification`. IDs are unique and the expected issue manifest is complete. |
| `review-request.json` | `schemaVersion`, `issueId`, `productSha`, `reviewId`, reviewer envelope identity, intent/evidence refs | A sealed request for a reviewer only; it has no implementer-session identifier, transcript, private task records, ambient-host configuration, or approval field. |
| `review-result.json` | `schemaVersion`, `reviewId`, `productSha`, `reviewer`, `startedAt`, `finishedAt`, `process`, `findings[]` | `process` attests a newly created process/session ID, parent/implementer IDs are absent, and each finding has stable ID, severity, disposition (`accepted`, `rejected`, `informational`), evidence refs, and time. A result cannot attest a different request SHA. |
| `finding-resolution.json` | `schemaVersion`, `findingId`, `reviewId`, `resolvedProductSha`, `resolver`, `resolvedAt`, `evidenceRefs[]` | Resolution is evidence of a repair attempt only; it does not close the finding without a renewed review naming `resolvedProductSha`. |

The expected-item manifest is code-owned per delivery/issue and must contain
the issue's six acceptance IDs and five Definition-of-Done IDs. A record is
incomplete if an expected ID is missing, duplicated, unchecked, or has an
unknown state. `not-applicable` is permitted only when the expected manifest
marks that ID eligible and the justification is present; it remains visible in
status rather than silently disappearing.

`evaluateFreshness(input)` is a pure function. Given the current product SHA,
expected manifest, validated acceptance document, validated review request and
result, and resolutions, it returns a deterministic decision:

- acceptance is fresh only if every required item is `pass` or justified
  eligible `not-applicable`, every item and the document name the current SHA,
  and its evidence references resolve to declared immutable ledger paths;
- review is fresh only if its request/result both name the current SHA, its
  result is successful, and its process attestation meets the independent
  reviewer contract;
- an accepted finding blocks until a resolution names the current SHA **and**
  a later renewed independent review at that SHA explicitly records the
  finding as resolved/non-accepted. A resolution alone never clears it;
- any product-SHA change makes every previous acceptance item, review,
  finding resolution, and approval stale. The evaluator returns stale IDs and
  `renew-acceptance-and-review`, never copies a prior pass forward.

The evaluator is the only authority that can return `promotionEligible: true`.
Its input surface deliberately has no `ccpmChecked`, `githubApproved`, or
`taskCompleted` field. Callers that need to display those observations must do
so outside the gate and cannot convert them to a pass.

## Parallel streams

### Stream A: Evidence domain, schemas, and pure freshness gate

**Scope**: Define canonical evidence documents, the explicit issue-item
manifest, canonical serialization/validation, and the side-effect-free
freshness/blocking evaluator. It does not read Git, spawn Codex, write a
ledger, load an envelope, or render status.

**Owned files**:

- `src/evidence/types.ts`
- `src/evidence/errors.ts`
- `src/evidence/schema.ts`
- `src/evidence/freshness.ts`
- `src/evidence/issue-manifest.ts`
- `test/evidence/schema.test.ts`
- `test/evidence/freshness.test.ts`
- `test/evidence/fixtures/**`

**Public contracts published to consumers**:

- `AcceptanceEvidence`, `AcceptanceItem`, `EvidenceState`, `ReviewRequest`,
  `ReviewResult`, `ReviewFinding`, `FindingResolution`, `EvidenceManifest`;
- `validateAcceptanceEvidence`, `validateReviewRequest`,
  `validateReviewResult`, `validateFindingResolution`, and
  `evaluateFreshness`;
- a serializable `EvidenceDecision` containing `acceptanceFresh`,
  `reviewFresh`, `blockingFindingIds`, `staleRecordIds`,
  `blockers`, and `nextAction`.

**Can start**: immediately against the committed Issue #2 TypeScript contract
style. It creates a new tree and does not edit `src/index.ts`, context,
ledger, status, or existing contracts.

**Verification responsibility**: table-driven deterministic tests cover every
unknown/missing/duplicate field and ID, invalid SHA/time/evidence reference,
ineligible or unexplained not-applicable item, and canonical round trip. The
freshness matrix covers all-pass, missing ID, blocked item, stale acceptance,
stale result, SHA change after a pass, accepted finding with no resolution,
resolution at the wrong SHA, resolution without renewed review, and renewed
review clearing a resolved finding. Tests explicitly show that synthetic
checked-CCPM/GitHub values cannot affect the decision because the evaluator
does not accept them.

### Stream B: Host-neutral review dispatch and isolated Codex process

**Scope**: Define the host-neutral reviewer-dispatch port and implement the
v1 Codex adapter. The adapter creates a real new ephemeral Codex process for
each review, passes only an exact reviewer envelope path and repository root,
captures bounded sanitized structured output, and verifies the adapter's
process attestation before returning it. It never constructs acceptance
evidence, writes ledger records, or decides finding freshness.

**Owned files**:

- `src/review/types.ts`
- `src/review/errors.ts`
- `src/review/dispatch.ts`
- `src/adapters/codex-review.ts`
- `test/review/dispatch.test.ts`
- `test/review/codex-review.test.ts`
- `test/review/helpers/fake-process.ts`

**Public contracts published to consumers**:

- `IndependentReviewAdapter`, `ReviewDispatch`, `EphemeralProcessRunner`,
  `ReviewProcessAttestation`, and `ReviewDispatchResult`;
- host-neutral request `{ host, reviewRequestPath, reviewerEnvelopePath,
  repoRoot }`, with `role: "reviewer"` proven from the trusted dispatch
  expectation rather than caller text;
- Codex v1 implementation selection (`host === "codex"` only); all other
  hosts return a deterministic unsupported-host blocker.

**Can start**: immediately. It uses the existing `ContextDispatchExpectation`
and `ContextReader` only as consumers: before spawning, dispatch validates
the trusted expectation and validated envelope are exactly reviewer-role;
the spawned process independently runs the existing product-SHA-before-ledger
read guard. It does not modify `src/context/**`.

**Real-process contract**: the Codex adapter invokes an executable via the
injected runner with a fresh temporary session/process directory and a fresh
process invocation for each request. It supplies no inherited Codex session,
conversation ID, transcript, implementer task path, or arbitrary ledger path.
The bounded environment contains only explicit executable/runtime settings and
the reviewer envelope/request/repository paths. Standard input carries a
canonical reviewer instruction that requires structured `review-result.json`;
stdout is parsed as that single document and stderr is redacted/bounded. The
result records the newly observed process/session identity and command version
as an attestation, but never credentials or hidden reasoning. A runner result
whose process is reused, whose parent/implementer identity is supplied, whose
role is not reviewer, or whose output SHA/review ID differs is rejected before
any ledger write.

**Verification responsibility**: deterministic fake-runner tests assert exact
argv/environment/input boundaries, fresh process/session per call, no ambient
session propagation, reviewer-only envelope paths, no implementation-record
path, and rejection before spawn for wrong role/stale envelope. A local
process-fixture test launches a separate Node child process (not a fake) which
echoes a canonical review result and records its PID; the parent asserts a
different PID and fresh temporary directory for two reviews. No test contacts
Codex or a network service. A separately opt-in, explicit operator probe may
invoke the installed Codex executable and must record only its process
attestation and sanitized result.

### Stream C: Ledger integration, status, review documentation, and gate orchestration

**Scope**: Persist/resolve the Stream A documents through Issue #3's exact
ledger APIs, assemble the trusted reviewer request/envelope handoff to Stream
B, project the pure decision into status, and add focused review skill/docs.
This stream is the only one that bridges evidence, dispatch, and ledger. It
does not redefine schemas, implement a process runner, or alter the shared
status projection.

**Owned files**:

- `src/acceptance/service.ts`
- `src/acceptance/ledger.ts`
- `src/acceptance/status.ts`
- `src/acceptance/errors.ts`
- `docs/review.md`
- `skills/shipyard-review/SKILL.md`
- `skills/shipyard-review/agents/openai.yaml`
- `skills/shipyard-review/references/review.md`
- `test/acceptance/service.test.ts`
- `test/acceptance/ledger.test.ts`
- `test/acceptance/status.test.ts`
- `test/integration/acceptance-review-gate/**`

**Can start**: documentation skeleton and status fixtures may start
immediately; service implementation starts only after A and B publish their
contracts. It consumes `GitLedgerStore.read(ledgerSha, paths)` (not a mutable
latest-head read), `ContextReader`, and `composeStatus`; it does not edit their
owner files.

**Ledger paths and transactions**: records live under
`deliveries/<deliveryId>/evidence/` with exact names
`acceptance.json`, `review-request-<reviewId>.json`,
`review-result-<reviewId>.json`, and `finding-resolution-<findingId>.json`.
The service uses an expected-head transaction and requires expected contents
for replacements. It pins the acceptance request/result relation before
dispatch, then re-reads the exact resulting ledger SHA and applies Stream A's
evaluator. Concurrent advance, same-path replacement, missing pinned record,
or a changed product head produces a blocker and no promotion-eligible result.

**Status contract**: C supplies a `StatusContributor`, leaving
`src/status/projection.ts` untouched. It sets `acceptanceFresh` only from
`EvidenceDecision`, adds explicit `acceptance-stale`, `review-stale`,
`accepted-finding`, or `evidence-incomplete` blockers, exposes safe provider
presentation only as non-authoritative data, and returns the precise next
action: gather evidence, resolve finding, renew review, or proceed to the
later promotion gate. Status remains read-only and must not load arbitrary
delivery documents; its caller supplies validated decision/pins.

**Verification responsibility**: disposable-Git integration tests prove the
canonical evidence records are written only to the orphan ledger and read at
their pinned SHA, a product commit change makes a previously passing bundle
stale, and a resolution plus renewed review is required after an accepted
finding. Ordered spies prove that a stale product SHA stops dispatch before
ledger write/result persistence. Status tests prove deterministic projection
for fresh/incomplete/stale/finding states and prove GitHub/CCPM presentation
cannot override a blocker. Documentation tests check the review skill's
focused references and next-safe-command examples.

## Acceptance and Definition-of-Done mapping

| Requirement | Implementation owner | Machine-verifiable evidence |
| --- | --- | --- |
| Stable IDs, state, SHA, evidence ref, verifier, and time for every acceptance/DoD item | A schemas; C persistence | Schema + manifest-completeness tests; exact-ledger-path integration fixture. |
| Product SHA changes stale prior acceptance/review and block promotion/finalization | A evaluator; C gate | Pure stale matrix and disposable-Git new-commit regression. |
| Separate ephemeral Codex reviewer with reviewer-only envelope | B; C assembles trusted input | Fake runner boundary tests and two-child-process PID/session fixture; wrong-role/no-spawn test. |
| Accepted findings require current-SHA resolution and renewed review | A evaluator; C persistence | Finding lifecycle matrix including resolution-alone rejection. |
| Checked CCPM boxes, raw completion, and GitHub approval are non-authoritative | A/C | Absent-from-evaluator contract test and status presentation-override negative test. |
| PRD AC-014 evidence closure | A/C | Complete exact-SHA manifest/evidence integration test. |
| PRD AC-015 independent review | B/C | Process isolation and reviewer-record-allowlist test. |
| DoD: deterministic validation output | A/B/C | Canonical JSON fixtures plus deterministic decision/CLI-safe report snapshots. |
| DoD: unit, stale-SHA, role-isolation, and independent-process tests | A/B/C | Aggregate `npm run typecheck`, `npm test`, targeted child-process suite. |
| DoD: acceptance/review documentation complete | C | Focused review skill/reference link test. |
| DoD: this issue's own evidence names its exact product SHA | Integration gate | Bootstrap procedure below; never a stream self-pass. |
| DoD: no unresolved accepted independent-review finding | Independent reviewer | Current-SHA renewed review result plus evaluator decision. |

These are implementation targets for AC-014/AC-015, not a release-wide claim
that all PRD acceptance criteria are complete.

## Coordination and ownership

| Surface | Owner / consumer rule |
| --- | --- |
| `src/evidence/**` and `test/evidence/**` | A exclusively. B/C import published types/functions and never add schema fields. |
| `src/review/**`, `src/adapters/codex-review.ts`, `test/review/**` | B exclusively. C uses `IndependentReviewAdapter`; it never invokes a process directly. |
| `src/acceptance/**`, review docs/skill, integration tests | C exclusively. A/B do not persist records or present status. |
| `src/context/**`, `src/ledger/**`, `src/adapters/ledger-git.ts`, `src/status/projection.ts` | Existing Issue #2/#3 ownership is read-only. C uses public/narrow ports; any missing export is a recorded single-file handoff after all streams pass. |
| `src/index.ts` | Preserve Issue #2 public-barrel ownership. One serialized post-stream export handoff only, after A/B/C APIs settle and no source stream edits it. |
| GitHub/provider/transport, workspace, promotion/finalization | Explicitly out of scope. Provider approval can be displayed but never passed to the evaluator. |

## Execution order

1. Start A and B in parallel in their disjoint trees. A publishes validated
   document/freshness contracts; B publishes the isolated adapter/result
   contract and its child-process fixture.
2. C consumes both inventories, binds the reviewer request to Issue #3's
   trusted reviewer envelope and pinned ledger reader, and integrates the
   deterministic gate/status/docs.
3. Serialize any `src/index.ts` public export addition through its established
   owner, then run typecheck, the full deterministic suite, focused stale-SHA
   and independent-process tests, and a disposable-Git orphan-ledger test.
4. Run the non-circular self-acceptance bootstrap and an independent reviewer
   against the final integrated product SHA. Any product change restarts step
   3 evidence collection and renewed review at the new SHA.

## Non-circular self-acceptance bootstrap

The feature cannot treat its ability to write an acceptance record as proof of
its own correctness. Use this sequence instead:

1. Before any Issue #6 candidate exists, freeze a small hand-authored,
   versioned external fixture corpus for valid/invalid evidence and a separate
   expected-item manifest in test code. Its assertions exercise validators and
   the evaluator without consuming a Shipyard-generated pass record.
2. Implement and commit the three streams. Record the exact clean candidate
   product SHA and the commands/output digests from a verifier outside the
   implementation process. A generated acceptance document is initially
   `blocked`/provisional; it cannot make itself pass.
3. The integration operator constructs a reviewer envelope from the trusted
   Issue #3 expectation, writes the sealed review request to the ledger, and
   launches B's new ephemeral Codex process. The reviewer receives only intent,
   acceptance, and review paths and independently attests that exact candidate
   SHA. The implementer process/session is never supplied or reused.
4. An external verifier records current-SHA acceptance evidence from the
   command outputs. The gate evaluates that record plus the independently
   produced review result. Only then may it report pass/eligible. Checked CCPM
   boxes and GitHub approval remain display-only observations throughout.
5. If review accepts a finding, record a resolution at a newly built exact
   product SHA, regenerate all acceptance evidence, and run a **new** separate
   reviewer process. The gate may clear the finding only from that renewed
   review. If the product SHA changes for any reason, invalidate steps 3–4 and
   repeat them.

This bootstrap intentionally makes the first approval depend on independent
execution plus externally observed test evidence, not on a circular claim by
the records/evaluator under test.

## Expected timeline

- Streams A and B in parallel: 10–12 wall-clock hours.
- Stream C, integration, and deterministic regression: 12–14 additional
  hours.
- Bootstrap, independent exact-SHA review, and remediation loop: 8–10 hours.
- Expected total: 30–36 engineering hours before a valid issue-close gate.
