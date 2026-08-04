---
issue: 2
stream: B — Binding, classification, and mutation lock core
started: 2026-08-04T02:59:05Z
updated: 2026-08-04T03:22:10Z
status: reviewer-findings-remediated
---

## Scope

Own `src/binding/**`, `src/policy/**`, `src/locking/**`, narrow local adapter
implementations, and their disposable-Git/unit tests. Do not edit package,
TypeScript configuration, public exports, CLI, skills, or docs.

## Progress

- Implemented injected adapters: `FilesystemAdapter`, `GitAdapter`, and
  `ProcessAdapter`; Node implementations are deliberately narrow and do not
  carry command guidance or provider policy.
- Implemented local typed binding boundary: `BindingService`, `BindingStore`,
  versioned binding document, structured `BindingError`, complete staged-pair
  and single-repository topology validation, explicit rebind protection, and
  remote/common-directory validation. Git identity canonicalizes symlinked
  paths so a main clone and linked worktree share one key.
- Implemented reusable `classifyPath`/`classifyPaths` one-owner policy boundary
  with product, development-record, development-generated, destination-only,
  context-overlay, and scratch coverage; unclassified/conflicting/unsafe paths
  reject before callers can mutate.
- Implemented exclusive repository mutation locks with malformed/repository
  mismatch guards and stale recovery only after same-host and dead-process
  validation; release revalidates ownership.
- API inventory requested for Stream A reconciliation (no Stream A files were
  edited): `nodeFilesystem`/`FilesystemAdapter`, `nodeGit`/`GitAdapter`,
  `nodeProcess`/`ProcessAdapter`, `BindingService`, `JsonBindingStore`,
  `BindingError`, binding types, `classifyPath`/`classifyPaths`,
  `PathPolicyError`, `MutationLockService`, and `MutationLockError`. Stream B
  uses a local topology shape because Stream A's public `Topology` does not
  include Git remote names needed for no-rewrite validation; integration should
  either map profile remotes to this boundary or add a reviewed remote-name
  contract.
- Tests: `npm run typecheck` passed; `npm test` passed (8 Stream A tests);
  `node --test dist/test/binding/*.test.js dist/test/policy/*.test.js
  dist/test/locking/*.test.js` passed (7 Stream B tests), including disposable
  linked-worktree common-directory equivalence and table-driven negative cases.
- Files changed: `src/adapters/{filesystem,git,process}.ts`, `src/binding/**`,
  `src/policy/path-classifier.ts`, `src/locking/mutation-lock.ts`, and owned
  `test/{binding,policy,locking,helpers}/**`.
- Terra-high finding 1 (lock check/remove race): remediated with an atomic
  mkdir lifecycle guard covering every acquire, stale-recovery, and release
  transition plus full lock-record identity comparison before release. A
  canonical lock cannot be replaced while an earlier owner is being checked or
  removed. Deterministic interleaving tests prove racing acquisition is blocked,
  subsequent acquisition survives, and a different identity is never removed.
- Terra-high finding 2 (shallow binding validation): remediated with recursive
  exact-key validation for the document, binding, topology, and remote layers;
  non-empty profile/common-directory/remotes; distinct staged remotes; canonical
  ISO timestamp validation; and validation on writes as well as reads. Hostile
  empty, invalid-date, unknown-field, partial-topology, invalid-remote, and
  wrong-container fixtures fail closed as `binding-store-invalid`.
- Terra-high finding 3 (incompatible/unvalidated path policy): remediated by
  consuming Stream A's canonical `PathPolicy` (`schemaVersion`) and invoking
  `validatePathPolicy` at the classification enforcement seam. Invalid owners,
  legacy version fields, and unknown rule fields now fail before matching.
- Post-remediation evidence: `npm run typecheck` passed and the aggregate
  `npm test` passed all 26 tests, including the disposable linked-worktree and
  new adversarial/race cases.
- Reconciliation request for Stream A: export `ExclusiveDirectoryResult` with
  `FilesystemAdapter`, and remove the now-redundant
  `ClassifiedPathOwner`/`ClassificationPathPolicy`/`ClassificationPathRule`
  aliases from `src/index.ts`; the classifier now re-exports the canonical
  contract types directly. No A-owned file was edited by Stream B.

## Coordination

- Implement against Stream A's contract shapes and reconcile once its export
  commit is available.
- Provide typed failures/data for Stream C; Stream C alone owns user guidance.
