---
issue: 3
product_sha: d73871ddd275e8915141dcc5a5283e1d1542da96
base_sha: bba2e5e083ea460deba92ffa686b986b8102067f
verified_at: 2026-08-04T09:40:26Z
verifier_model: gpt-5.6-terra
verifier_effort: high
result: pass
---

# Issue #3 exact-SHA acceptance evidence

This record applies only to product commit
`d73871ddd275e8915141dcc5a5283e1d1542da96` on `epic/shipyard-v1`, compared
with accepted base `bba2e5e083ea460deba92ffa686b986b8102067f`.

## Verification commands and results

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | Exact SHA confirmed. |
| `git diff --check bba2e5e... d73871d...` | PASS; no whitespace errors. |
| `npm run typecheck` | PASS (`tsc --noEmit`). |
| `npm test` | PASS; 209 passed, 0 failed, 1 authorized live fixture skipped. |
| `npm pack --dry-run --json` | PASS; 141 packaged entries with integrity metadata. |
| final `git status --short` | PASS; product worktree clean. |

## Acceptance criteria

| Criterion | Result | Exact-SHA evidence |
| --- | --- | --- |
| Stable delivery ID, canonical branch, linked worktree, and isolated ledger create/resume | PASS | Registry/workspace integration covers fresh creation, every interrupted boundary, durable ownership/readiness proof, retry, recreation, and delivery-ID reuse. |
| Authoritative-main, partial, ambiguous, and conflicting state rejection | PASS | Workspace/resolver suites reject direct main work, foreign branches/worktrees, missing proofs, detached/wrong identities, same-SHA races, and ambiguous registrations. |
| Linked-worktree and explicit-ID resolution plus stale/concurrent ledger handling | PASS | Resolver and ledger suites cover common-directory identity, explicit selection, optimistic CAS, same-path conflicts, concurrent writers, and pinned reads. |
| Role-minimal host-neutral context envelopes | PASS | Context tests prove exact implementer/reviewer/status allowlists, detached immutable snapshots, and rejection of forged topology, role, repository, object format, accessors, and Proxies. |
| Stale product SHA stops before ledger reads | PASS | Ordered context-reader tests prove zero pinned-ledger reads on product-SHA mismatch. |
| Ledger isolation and retention | PASS | Disposable Git tests prove the canonical orphan ledger is outside product ancestry, remains after feature cleanup, and is rejected from product refspecs/payloads together with Shipyard proof refs. |
| Creation, interrupted resume, recreation, ambiguity, and cleanup handoff | PASS | Disposable integration coverage exercises all required lifecycle states; cleanup hands existing Git state to the operator and never deletes a replacement path. |
| PRD AC-008, AC-009, AC-010 | PASS | AC-008 maps to ledger isolation/retention; AC-009 to role allowlists; AC-010 to pre-ledger stale-product rejection. |

## Definition of Done

| Requirement | Result | Evidence |
| --- | --- | --- |
| No product-branch metadata writes | PASS | Ledger and workspace records use the isolated ledger/proof refs; product transport exclusions are tested. |
| Unit, worktree, concurrency, stale-envelope tests | PASS | Full deterministic suite passed at the exact SHA. |
| Ledger/context documentation | PASS | Packaged ledger/context and recovery documentation passed distribution checks. |
| Exact SHA and verifier | PASS | This record names the exact product/base SHA, UTC time, model, and effort. |
| Independent review | PASS | See [issue-3-d73871d](../reviews/issue-3-d73871d.md). |

## Resolution history

Repeated Terra-high review findings were resolved before this gate, including
workspace lifecycle races, durable Git proof authority, live branch/worktree
revalidation, hostile serialized context objects, ledger isolation, and
product-transport exclusions. No accepted issue #3 finding remains unresolved
at this SHA.
