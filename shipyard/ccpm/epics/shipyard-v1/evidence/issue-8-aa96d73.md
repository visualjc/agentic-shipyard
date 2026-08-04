---
issue: 8
product_sha: aa96d73d46a490fafd56453bf60f5fb23e47e029
base_sha: d03351135a44e9f2017ae1dedb646d488d33824c
verified_at: 2026-08-04T20:52:18Z
verifier_model: gpt-5.6-sol
verifier_effort: xhigh
result: implementation-pass-external-fixture-pending
---

# Issue #8 exact-SHA acceptance evidence

This record applies only to integrated product commit
`aa96d73d46a490fafd56453bf60f5fb23e47e029` on `epic/shipyard-v1`, compared
with accepted base `d03351135a44e9f2017ae1dedb646d488d33824c`. The integrated
tree `6b0875a44a5bf541c123987e33a38e4bffb4c660` is byte-identical to the
independently reviewed candidate.

## Verification commands and results

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` and `git rev-parse HEAD^{tree}` | Exact SHA and accepted tree confirmed. |
| `git diff --check HEAD^ HEAD` | PASS. |
| `npm run typecheck` | PASS. |
| full deterministic suite | PASS; 467 tests, 465 passed, 0 failed, 2 expected environment-gated skips. |
| focused single-repository suites | PASS; schema, ledger, certification, provider, finalization, recovery, local Git, distribution, and workspace cleanup. |
| `npm pack --dry-run --json` | PASS; 309 entries, 219,267 bytes packed, 962,553 bytes unpacked. |
| protected shared finalizer | PASS; `src/finalization/service.ts` remains base blob `3c607ee8144eccd7ff53c9ee7f24644c52b88adb`. |
| final `git status --porcelain` | PASS; clean. |

The two skips are environment/external gates, including the unauthorized live
private provider fixture. The current code-owned allowlist is empty. No live
GitHub request, authenticated remote transport, or external mutation ran.

## Acceptance criteria

| Criterion | Result | Exact-SHA evidence |
| --- | --- | --- |
| Existing bound PR and exact evidence head | PASS | Certification revalidates actor, repository/remote/default branch, same-repository head/base refs, current PR head/tree, tracked issue, marker, dossier digest, path receipt, acceptance, and independent review. |
| Prohibited metadata and path ownership | PASS | Git-native classification and current manifest digest are checked before certification and again before finalization; forbidden/unclassified paths block before provider mutation. |
| One idempotent dossier, no second PR | PASS | The provider port can observe/update only the exact marked PR and tracked issue; it has no create-PR or merge method. Same-SHA renewal keys include the dossier digest. |
| Human-merge-only transition | PASS | Finalization requires the expected PR/head/tree/base to be observed merged; no automatic merge capability exists. |
| Resumable ledger/tag/archive/cleanup | PASS | Strict consecutive recovery steps cover workspace cleanup, branch-delete intent/deletion, and final receipt. Original manifest/intent/receipt bytes and exact branch/seal state are revalidated on resume. |
| Revalidation and immutable delivery binding | PASS | Every loaded durable record is bound to the caller-selected delivery ID; recovery cannot redirect through embedded content. The full recovery prefix is reread immediately before narrow remote observation/deletion. |
| Local and private synthetic coverage | PASS deterministic / PENDING external gate | Disposable Git and fake-provider matrices pass. The live private fixture is unauthorized and must be completed before release-ready status. |
| PRD AC-016 and AC-018 | PASS deterministic | Existing-PR certification, human merge observation, exact cleanup/recovery, metadata containment, and no-second-PR behavior are covered at this SHA. |

## Definition of Done

| Requirement | Result | Evidence |
| --- | --- | --- |
| No second PR or automatic merge | PASS | Type-limited provider interfaces and negative capability tests. |
| Local/private topology tests | PASS deterministic / PENDING external gate | 467-test suite passes locally; live fixture remains explicitly skipped. |
| Operation and recovery documentation | PASS | Packaged single-repository and recovery runbooks match actual checkpoint ordering. |
| Exact SHA and verifier | PASS | This record and the exact integrated tree/commit above. |
| Independent review | PASS | See [issue-8-aa96d73](../reviews/issue-8-aa96d73.md). |

This implementation evidence is sufficient for the initial development PR and
for Issue #9 to consume the typed handoff. It is not a release-ready receipt;
Issue #11 must retain the private-fixture blocker.
