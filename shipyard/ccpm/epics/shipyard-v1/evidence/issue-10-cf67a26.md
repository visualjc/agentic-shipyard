---
issue: 10
product_sha: cf67a26e7f0dbdac356739a4f81d9090d1668bcf
base_sha: 3fd4858fbb007233cc93ad6fb93282d55fa11cad
verified_at: 2026-08-04T12:12:23Z
verifier_model: gpt-5.6-terra
verifier_effort: high
result: pass
---

# Issue #10 exact-SHA acceptance evidence

This record applies only to integrated product commit
`cf67a26e7f0dbdac356739a4f81d9090d1668bcf` on `epic/shipyard-v1`, compared
with accepted base `3fd4858fbb007233cc93ad6fb93282d55fa11cad`.

## Verification commands and results

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | Exact SHA confirmed. |
| `git diff --check 3fd4858... cf67a26...` | PASS. |
| `npm run typecheck` / build | PASS. |
| full deterministic suite | PASS; 356 tests, 354 passed, 0 failed, 2 environment-gated skips. |
| focused final status/CLI suite | PASS; 20 tests. |
| distribution/package suite | PASS; six focused checks. |
| `npm pack --dry-run --json` | PASS; 203 entries, 126,721 bytes packed, 506,800 bytes unpacked. |
| final `git status --short` | PASS; clean. |

The skipped tests are the unapproved private provider fixture and the local
platform's unavailable SHA-256 remote capability; graph authority and local
source-fingerprint tests themselves are deterministic and passing.

## Acceptance criteria

| Criterion | Result | Exact-SHA evidence |
| --- | --- | --- |
| Exact commit and working-tree authority with divergent-worktree isolation | PASS | Git-native source snapshots include commit, tracked/untracked state, modes, symlinks, gitlinks, and worktree-instance identity; cache and lock identities stay per physical worktree. |
| Graphify relocation and product-tree protection | PASS | Matching external output variables, cache-content digests, whole-tree audit, known code-owned leak cleanup, arbitrary/concurrent change preservation, and fail-closed ambiguity tests pass. |
| CodeGraph runtime, exclusion, and empirical seed boundary | PASS | Actual Node/SQLite FTS5 probe, telemetry-off child, machine-local exclusion, tracked-cache rejection, and empirical wording pass. |
| Freshness lifecycle | PASS | Commit, dirty edit, checkout, rebase, restart, recreation, live/stale/unknown lock, unavailable tool, and source-change-during-operation matrices select the correct conservative state. |
| Direct-source fallback and read-only status | PASS | Disabled/stale/failed/unavailable/blocked/invalid graphs are non-authoritative and select direct inspection without process/cache/lock mutation. |
| Understand Anything deferred | PASS | No authoritative adapter or status option is exposed. |
| PRD AC-022 | PASS | Exact-source graph freshness and fallback are evidenced by the full graph and integrated status suites. |

## Security and authority closure

- Only the controlled graph-lane service is public; raw mutation adapters are
  absent from the package barrel.
- Baseline authority derives Shipyard-owned descriptor/cache facts from live
  clean main and rejects caller-supplied cache authority.
- Profiles and descriptors bind executable SHA-256 digests; production hashes
  before observation and every spawn, so sidecar and swap attacks fail.
- Bounded detached process groups terminate descendants on timeout/output
  overflow.
- Sync and graph freshness occupy distinct status fields; a disabled graph
  cannot erase synchronization blockers or next actions.

## Definition of Done

| Requirement | Result | Evidence |
| --- | --- | --- |
| Experimental adapters and safe fallback | PASS | Controlled production services and deterministic fake seams pass. |
| Exact-source/restart tests | PASS | Full exact-SHA suite. |
| Privacy/runtime documentation | PASS | Packaged Graphify, CodeGraph, setup, status, and skill references passed distribution review. |
| Exact SHA/verifier | PASS | This record. |
| Independent review | PASS | See [issue-10-cf67a26](../reviews/issue-10-cf67a26.md). |
