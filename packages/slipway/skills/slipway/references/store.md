# Durable store

Slipway uses Git-backed Markdown records without a runtime or shared database.

## Locations

The ignored agentic-worktree file `.slipway-local/binding.md` locates the paired repositories and dedicated ledger worktree. Portable state lives only on the parallel `slipway-ledger` branch:

```text
.slipway/
  project.md
  preferences.md
  runs/<complete-work-branch>/
    manifest.md
    status.md
    gates.md
    artifacts.md
    events/*.md
  archive/<complete-work-branch>/summary.md
  portfolio.md
```

Branch slashes intentionally create nested directories. Discover runs recursively by finding `manifest.md`; read the canonical branch from the manifest rather than inferring it from directory depth. `portfolio.md` is an optional derived snapshot, not write authority.

## Identity

Validate a proposed run name with `git check-ref-format --branch`. Require the full agentic work-branch name, one active run per branch, and no prior run or archive using that name. Recursively read every active manifest and reject a candidate when either branch name is a slash-delimited path prefix of the other, such as `feature/a` and `feature/a/b`; run shard paths must remain disjoint even if refs are packed or stale. Never reuse a work-branch name.

A rename is a migration, not a fresh run. Verify old and new refs, confirm the new name has never been used, move the shard to the matching path, record `Former branch`, update every branch pointer, commit the ledger migration, then rename or verify the agentic branch. Stop if either side cannot be made consistent without discarding work.

Pstack worker branches and ticket branches are units within the parent run. They do not create top-level Slipway run shards unless the user explicitly starts an independent delivery.

## Writers

One run coordinator owns `manifest.md`, `status.md`, `gates.md`, and `artifacts.md`. Workers and reviewers must not edit those files. They add one immutable event with a unique name such as `20260804T231500Z-review-agent7-a1b2.md`. Never replace or delete an event before finalization.

Different runs own disjoint paths. Stage only explicit files and never use `git add .` in the ledger worktree. A worker stages and commits only its new event file. A coordinator names its owned summary files and the exact reconciled events explicitly. Prefer `git commit --only -- <exact-path>...` so another run or worker's staged paths cannot enter the commit.

Git serializes index and ref updates. If an index or ref lock is busy, stop the current Git operation, re-read ledger HEAD and status, and retry the exact scoped operation. Never delete a lock automatically. A failed ref update requires rebasing the pending record on the new ledger HEAD and rechecking the path; do not overwrite another run.

Global project/preferences changes require an explicit setup window. Finalization writes only the run's disjoint archive summary and removes that run's manifest, status, gates, artifacts, and event files by exact path in the same scoped commit. Never recursively remove a run directory; prune only empty directories after confirming no other manifest lies below them. Status derives the portfolio by scanning active manifests and archive summaries, so concurrent runs do not continuously rewrite a global file.

## Records

- `manifest.md` owns identity, lane, build provider, phase, repository refs, delivery PR, and coordinator.
- `status.md` owns the compact done/pending split, verified observations, open gates, and exactly one next action.
- `gates.md` owns human, capability, product-decision, and external-write gates.
- `artifacts.md` indexes canonical artifacts by type, owner skill, exact branch/SHA or URL, and disposition.
- `events/*.md` records worker, QA, review, promotion, feedback, sync, or finalization evidence tied to exact SHAs.
- `archive/**/summary.md` retains the compressed outcome, final refs, evidence pointers, and retained development tag after active details leave the ledger tip.

Treat records as claims. Verify Git state before acting and provider state only when the next action depends on it. Never store tokens, secrets, full untrusted comments, or secret-bearing output.

## Pause and resume

Pause after the current atomic Git operation. Drain or account for every worker result, update coordinator-owned files, commit the run path, and name one next action. A pause is safe only when a fresh session can resume without the chat.

Resume by reading project/preferences, the run manifest/status/gates/artifacts, and all events newer than the last reconciled event. Verify the branch and recorded SHAs. Reconcile discrepancies as new facts; never rewrite history or treat a stale exact-SHA verdict as current.
