---
issue: 2
product_sha: bba2e5e083ea460deba92ffa686b986b8102067f
base_sha: 7bfe2565d9ef2bc1af6f5caacc298aa32e5efbaa
verified_at: 2026-08-04T04:15:39Z
verifier_model: gpt-5.6-terra
verifier_effort: high
result: pass
---

# Issue #2 exact-SHA acceptance evidence

This record applies only to product commit
`bba2e5e083ea460deba92ffa686b986b8102067f` on `epic/shipyard-v1`, compared
with baseline `7bfe2565d9ef2bc1af6f5caacc298aa32e5efbaa`. The product worktree
was clean before and after verification.

## Verification commands and results

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | `bba2e5e083ea460deba92ffa686b986b8102067f` |
| `git diff --check 7bfe2565d9ef2bc1af6f5caacc298aa32e5efbaa bba2e5e083ea460deba92ffa686b986b8102067f` | PASS; no whitespace errors |
| `npm ci` | PASS; 3 packages installed, 0 vulnerabilities |
| `npm run typecheck` | PASS (`tsc --noEmit`) |
| `npm test` | PASS; 46 tests, 0 failures |
| `npm pack --json --pack-destination <temporary-dir>` | PASS; package built and packed (79 entries) |
| `npm install --prefix <temporary-dir>/install <packed-tarball>` then `<prefix>/node_modules/.bin/shipyard-help status` | PASS; installed CLI printed read-only status help |
| final `git status --short` | PASS; empty output (clean) |

## Acceptance criteria

| Criterion | Result | Exact-SHA evidence |
| --- | --- | --- |
| TypeScript ESM package, `shipyard` CLI, and Codex project/user skill layout | PASS | Package, executable command mappings, canonical `skills/*`, and `.agents/skills/*` discovery are present; tests 19, 20, 30, and 31 passed. |
| Versioned schemas for profiles, bindings, path policies, operations, and lifecycle state | PASS | Contract tests 22–29 passed, including unsupported version, unknown-field, topology, operation, policy, and lifecycle rejection. |
| Reusable one-owner path classifier rejects unclassified/conflicting ownership | PASS | Tests 41–44 passed, including fail-closed and profile-authorized policy coverage. |
| Short mutation lock validates process/host before stale recovery | PASS | Tests 32–40 passed, including concurrent locks, malformed records, host/process checks, and recovery races. |
| Extensible status projection aggregates contributed state | PASS | Tests 45–46 passed. |
| Setup validates complete topology, never provisions/rewrites remotes, and requires explicit rebind | PASS | Tests 2, 8–18 passed, including topology validation, deterministic guidance, rebind, profile authority, and concurrent setup protection. |
| Main clone and linked worktree resolve the same binding by Git common directory | PASS | Tests 3 and 10 passed. |
| Missing, partial, duplicate, stale, and remote-mismatched bindings fail before mutation with guidance | PASS | Tests 1, 4–7, 9, and 18 passed. |
| Status/help are read-only and return the next safe action | PASS | Tests 8, 15, 18 and the installed `shipyard-help status` probe passed. |
| PRD AC-001, AC-002, AC-021, and foundational AC-023 | PASS | AC-001: tests 1, 8–18; AC-002: tests 3 and 10; AC-021: tests 13, 17, 32–40; AC-023 foundation: tests 8, 15, 19, 20, 30, 31 and installed help probe. |

## Definition of Done

| Requirement | Result | Evidence |
| --- | --- | --- |
| Typed public interfaces | PASS | `npm run typecheck` passed. |
| Unit and disposable Git integration tests | PASS | `npm test`: 46/46 passed, including linked-worktree and setup integration tests. |
| Focused setup/status/help documentation | PASS | Packed artifact contains focused docs and canonical skills; tests 19, 20, 30, 31 passed. |
| Exact product SHA and verifier named | PASS | This record names the exact product/base SHA, UTC verification time, and `gpt-5.6-terra` high verifier. |
| No unresolved accepted independent-review finding | PASS | See [independent review record](../reviews/issue-2-bba2e5e.md). |

## Resolution history

Accepted Terra-high findings were corrected before this exact-SHA gate: package
distribution/installability; binding validation and path-policy compatibility;
setup identity and lock handling; canonical binding/profile authority and Codex
skill discovery; lifecycle recovery and packaged skill installation; and narrow
installer/barrel-import/lock-record safety. The final test run above includes
their regression coverage. No accepted finding remains unresolved at this SHA.

Independent-review context is recorded separately and does not represent or
reproduce reviewers' hidden reasoning.
