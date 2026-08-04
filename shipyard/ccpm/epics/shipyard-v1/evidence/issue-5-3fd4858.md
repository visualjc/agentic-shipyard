---
issue: 5
product_sha: 3fd4858fbb007233cc93ad6fb93282d55fa11cad
base_sha: d73871ddd275e8915141dcc5a5283e1d1542da96
verified_at: 2026-08-04T11:11:27Z
verifier_model: gpt-5.6-terra
verifier_effort: high
result: pass
---

# Issue #5 exact-SHA acceptance evidence

This record applies only to product commit
`3fd4858fbb007233cc93ad6fb93282d55fa11cad` on `epic/shipyard-v1`, compared
with accepted base `d73871ddd275e8915141dcc5a5283e1d1542da96`.

## Verification commands and results

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | Exact SHA confirmed. |
| `git diff --check d73871d... 3fd4858...` | PASS; no whitespace errors. |
| `npm run typecheck` | PASS (`tsc --noEmit`). |
| `npm test` | PASS; 301 tests, 299 passed, 0 failed, 2 capability-gated skips. |
| `npm pack --dry-run --json` | PASS; 169 packaged entries, 97,140-byte package, 382,492 bytes unpacked. |
| final `git status --short` | PASS; product worktree clean. |

The skipped cases are the unapproved private live fixture and the platform's
unavailable SHA-256 remote capability. Their absence does not weaken the local
SHA-1/SHA-256 object-ID validation and deterministic negative-path coverage.

## Acceptance criteria

| Criterion | Result | Exact-SHA evidence |
| --- | --- | --- |
| Clean non-divergent default sync fast-forwards development `main` to exact destination `main` | PASS | Disposable Git integration proves preflight, fetch/re-observation, fast-forward-only update, exact post-state, and compensation behavior. |
| Dirty, divergent, unexpected-remote, and non-fast-forward states block without repair | PASS | Negative matrices cover worktree/index dirt, checked-out branch drift, ahead/diverged histories, remote mismatch, observation races, lock contention, and commit-time ref races with no rebase/reset/merge. |
| One-owner classification is mandatory | PASS | Relevant path deltas are classified before mutation; unclassified and conflicting ownership stop with refs and ledger unchanged. |
| Explicit named source import records proof-bound provenance | PASS | Branch, tag, and full-ref cases stage an exact object into the canonical namespace only after explicit input; remote/name/object/checkpoint proof is validated before commit. |
| Source refs cannot be published and drift blocks later use | PASS | Product refspec/payload gates reject the namespace; live remote/name/SHA and local proof/ref drift are detected before use. |
| Sync does not promote, finalize, force-push, or rewrite feature work | PASS | Public API, CLI, transport, and Git-operation allowlists expose only bounded sync operations; failure compensation preserves unrelated user changes. |
| PRD AC-005 and AC-006 | PASS | AC-005 maps to exact clean baseline fast-forward; AC-006 maps to explicit source import plus immutable provenance checks. |

## Definition of Done

| Requirement | Result | Evidence |
| --- | --- | --- |
| Narrow `shipyard-sync` operation | PASS | CLI, Agent Skill, command service, and public exports are limited to baseline/source sync. |
| Local staged-pair and negative-divergence coverage | PASS | Full exact-SHA suite includes disposable local Git, concurrency, compensation, SHA form, transport, and status tests. |
| Documentation | PASS | Packaged synchronization and recovery docs describe every fail-closed next action and publication exclusion. |
| Exact SHA and verifier | PASS | This record names the exact product/base SHA, UTC time, model, and effort. |
| Independent review | PASS | See [issue-5-3fd4858](../reviews/issue-5-3fd4858.md). |

## Resolution history

Repeated medium-implementation/high-review cycles repaired ledger checkout and
CAS rollback, commit-time two-ref races, source-publication bypasses, public
raw-Git exposure, transport boundaries, proof binding, resource bounds, and
failure compensation. No accepted issue #5 finding remains unresolved at this
SHA.
