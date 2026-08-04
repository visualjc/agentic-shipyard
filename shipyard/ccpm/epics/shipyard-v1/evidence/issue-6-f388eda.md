---
issue: 6
product_sha: f388eda8c41ab3085d5b3ada6f1bb8e180952933
base_sha: cf67a26e7f0dbdac356739a4f81d9090d1668bcf
verified_at: 2026-08-04T12:37:28Z
verifier_model: gpt-5.6-terra
verifier_effort: high
result: pass
---

# Issue #6 exact-SHA acceptance evidence

This record applies only to integrated product commit
`f388eda8c41ab3085d5b3ada6f1bb8e180952933` on `epic/shipyard-v1`, compared
with accepted base `cf67a26e7f0dbdac356739a4f81d9090d1668bcf`.

## Verification commands and results

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | Exact SHA confirmed. |
| `git diff --check cf67a26... f388eda...` | PASS. |
| TypeScript typecheck/build | PASS. |
| full deterministic suite | PASS; 427 tests, 425 passed, 0 failed, 2 environment-gated skips. |
| focused Codex-review suite | PASS; 16 tests. |
| `npm pack --dry-run --json` | PASS; 242 entries, 154,646 bytes packed, 625,001 bytes unpacked. |
| final `git status --short` | PASS; clean. |

The skipped tests are the unapproved private provider fixture and the local
platform's unavailable SHA-256 remote capability. They do not weaken the
deterministic exact-SHA evidence, role-isolation, or process-boundary tests.

## Acceptance criteria

| Criterion | Result | Exact-SHA evidence |
| --- | --- | --- |
| Stable acceptance/DoD records | PASS | Canonical schemas enforce stable item ID/kind/state, exact product SHA, evidence references, verifier, and verification time with bounded record and aggregate sizes. |
| SHA freshness | PASS | Product-SHA or pinned-ledger change makes acceptance and review stale and selects a blocking next action. |
| Independent Codex review | PASS | The trusted factory creates a fresh child/session over an immutable detached snapshot and one canonical path-redacted reviewer bundle. |
| Finding closure | PASS | Accepted findings remain blocking until exact-SHA resolution and a renewed later review satisfy ordinal and bundle-digest gates. |
| Non-authoritative presentation state | PASS | CCPM boxes, task state, and GitHub approval cannot clear the pure evidence gate. |
| PRD AC-014 / AC-015 | PASS | Exact-SHA closure and independent reviewer isolation are covered by unit and integration suites. |

## Security and process closure

- Review input is reconstructed from pinned canonical ledger records and bound
  to manifest, acceptance, request, result, and reviewer-bundle digests.
- Source, envelope, and ledger paths do not enter the reviewer bundle.
- Ledger inventory, immutable-snapshot Git, and Codex children enforce fixed
  timeout/output ceilings and whole-process-group teardown checks.
- Snapshot verification is sequential; no sibling Git child survives an early
  failure. Private state is preserved for manual recovery when teardown cannot
  be proven.
- `shipyard-review` is packaged, source-discoverable, and explicitly
  command-scoped through canonical invocation metadata.

## Definition of Done

| Requirement | Result | Evidence |
| --- | --- | --- |
| Deterministic implementation | PASS | Full schema, gate, ledger, and adapter suites. |
| Stale-SHA, role, and process tests | PASS | Full exact-SHA suite plus focused 16-test Codex-review suite. |
| Documentation and skill | PASS | Package and source-discovery contracts include review help, references, launcher, metadata, and symlink. |
| Exact SHA/verifier | PASS | This record. |
| Independent review | PASS | See [issue-6-f388eda](../reviews/issue-6-f388eda.md). |
