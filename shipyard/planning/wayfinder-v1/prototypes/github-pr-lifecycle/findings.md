# GitHub staged-pair lifecycle findings

Date: 2026-08-03  
Fixtures:

- <https://github.com/visualjc/shipyard-fixture-staged>
- <https://github.com/NativeInteractive/shipyard-fixture-staged>

## Result

The real-host synthetic lifecycle completed successfully with Codex as the only
live agent host. The initial exercise reached 19 passing assertions before a
GitHub CLI `pr edit` compatibility failure; the exact remote state was retained,
revalidated, and completed by a 14-assertion resume exercise.

The externally inspectable outcomes are:

- development PR: <https://github.com/visualjc/shipyard-fixture-staged/pull/2>
  — closed without merge;
- destination PR:
  <https://github.com/NativeInteractive/shipyard-fixture-staged/pull/1>
  — merged normally inside the destination repository;
- development issue:
  <https://github.com/visualjc/shipyard-fixture-staged/issues/1>
  — closed after destination delivery.

Both private repositories remain available for human inspection. Delete only
these exact fixtures, with a command-scoped `visualjc` credential, after Jim
accepts the findings.

## Proven behavior

- Every GitHub API command used an explicitly acquired `visualjc` token and
  verified `gh api user` before mutation.
- Both fixtures reported private visibility and `ADMIN` access.
- The development repository retained only its own writable `origin`; it did
  not retain a destination remote.
- The workflow issue existed only in the development repository.
- Two independent ephemeral Codex processes reviewed two exact development
  SHAs. The second development commit invalidated the first attestation and
  required a new review record.
- The destination PR was `isCrossRepository: false`, with
  `NativeInteractive` as its head-repository owner.
- Destination feedback was implemented on the development branch, reviewed at
  the new SHA, and appended to the destination branch as a second commit. No
  force push was used.
- Each destination commit's tree exactly matched its corresponding reviewed
  development tree.
- The destination merge endpoint required the expected final head SHA.
- After merge, destination `main` fast-forwarded development `main` to the exact
  same merge commit.
- The development PR closed without merge; the destination PR was merged.
- Both delivery branches were deleted.
- `shipyard-ledger` and the annotated reviewed tag remained development-only.
- Destination `main` contained no ledger, PRD/spec, graph, or `.shipyard` path.
- The GitHub CLI configuration fingerprint was unchanged.

## Operational findings that change v1

1. **Isolate Git credentials as well as `gh`.** `GH_TOKEN` scopes `gh` but not a
   separate `git push`. The first push inherited the global credential helper
   and was rejected. Shipyard must disable inherited helpers per Git command and
   use an ephemeral askpass/token environment after verifying the actor.
2. **Prefer the GitHub REST API for deterministic mutations.** The installed
   GitHub CLI's `gh pr edit` failed because its GraphQL query requested retired
   Projects Classic fields. Updating the PR body through REST succeeded.
3. **Do not equate one GitHub approval with Shipyard review evidence.** The same
   scoped fixture actor authored both PRs, so official approval dismissal and
   distinct-human branch protection were not testable. V1 correctness must use
   exact-SHA ledger attestations; destination human approval remains the team's
   own policy.
4. **Make finalization resumable.** The retained remote state made it safe to
   resume after the PR-body update failed. Production state must checkpoint each
   external mutation and revalidate exact refs before continuing.

## Deferred evidence

- multi-account switching;
- official approval dismissal and protected-branch variations;
- distinct development and destination GitHub actors;
- Claude/CCPM and Cursor/Pstack live dispatch;
- any Just Games repository or identity.

## Reproduction sources

- [`prototype.mjs`](prototype.mjs) — one-shot exercise, corrected to use REST
  for PR-body updates;
- [`resume.mjs`](resume.mjs) — exact-state recovery path used after the CLI
  compatibility failure.
