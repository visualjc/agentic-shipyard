# Durable store

Slipway uses Git-backed Markdown records without a runtime or shared database.

## Locations

The ignored agentic-worktree file `.slipway-local/binding.md` locates the paired repositories and dedicated ledger worktree. Portable state lives only on the parallel `slipway-ledger` branch:

```text
.slipway/
  project.md
  preferences.md
  context/
    manifest.yaml
    modules/<module-id>/CONTEXT.md
    modules/<module-id>/**
  runs/<complete-work-branch>/
    manifest.md
    status.md
    gates.md
    artifacts.md
    events/*.md
  archive/<complete-work-branch>/summary.md
  portfolio.md
```

The ledger owns one project-wide private context registry at
`.slipway/context/`; it is not a run shard and never belongs in product
ancestry. Its version is the Git **tree object ID** for `HEAD:.slipway/context`,
not ledger `HEAD`, so unrelated run records do not change its version. The
canonical seed is under `assets/context/`.

`manifest.yaml` declares each module's ID, Markdown entrypoint, required or
optional status, applicable operations, capability requirements, repository
markers, and propagation targets. Modules are declarative context only: they
must not declare commands, executable hooks, or permission grants.

Every Repo-B worktree may cache the exact validated tree under ignored
`.slipway-local/context/` and records it in `.slipway-local/context.version`.
The ledger remains authoritative. The Repo-B clone's repository-local Git
exclude, shared by linked worktrees, must include `/.slipway-local/`; Slipway
may manage only that pattern and must preserve unrelated exclusions. Never add
the cache to shared `.gitignore`, and never use `skip-worktree` or
`assume-unchanged`. Nothing is materialized as a root host instruction file.

Branch slashes intentionally create nested directories. Discover runs recursively by finding `manifest.md`; read the canonical branch from the manifest rather than inferring it from directory depth. `portfolio.md` is an optional derived snapshot, not write authority.

## Identity

Validate a proposed run name with `git check-ref-format --branch`. Require the full agentic work-branch name, one active run per branch, and no prior run or archive using that name. Recursively read every active manifest and reject a candidate when either branch name is a slash-delimited path prefix of the other, such as `feature/a` and `feature/a/b`; run shard paths must remain disjoint even if refs are packed or stale. Never reuse a work-branch name.

A rename is a migration, not a fresh run. Verify old and new refs, confirm the new name has never been used, move the shard to the matching path, record `Former branch`, update every branch pointer, commit the ledger migration, then rename or verify the agentic branch. Stop if either side cannot be made consistent without discarding work.

Pstack worker branches and ticket branches are units within the parent run. They do not create top-level Slipway run shards unless the user explicitly starts an independent delivery.

## Writers

One run coordinator owns `manifest.md`, `status.md`, `gates.md`, and `artifacts.md`. Workers and reviewers must not edit those files. They add one immutable event with a unique name such as `20260804T231500Z-review-agent7-a1b2.md`. Never replace or delete an event before finalization.

Different runs own disjoint paths. Stage only explicit files and never use `git add .` in the ledger worktree. A worker stages and commits only its new event file. A coordinator names its owned summary files and the exact reconciled events explicitly. Prefer `git commit --only -- <exact-path>...` so another run or worker's staged paths cannot enter the commit.

Git serializes index and ref updates. If an index or ref lock is busy, stop the current Git operation, re-read ledger HEAD and status, and retry the exact scoped operation. Never delete a lock automatically. A failed ref update requires rebasing the pending record on the new ledger HEAD and rechecking the path; do not overwrite another run.

Global project, preferences, or private-context changes require an explicit setup
window. Finalization writes only the run's disjoint archive summary and removes
that run's manifest, status, gates, artifacts, and event files by exact path in
the same scoped commit. Never recursively remove a run directory; prune only
empty directories after confirming no other manifest lies below them. Status
derives the portfolio by scanning active manifests and archive summaries, so
concurrent runs do not continuously rewrite a global file.

## Records

- `manifest.md` owns identity, lane, build provider, phase, repository refs, delivery PR, and coordinator.
- `status.md` owns the compact done/pending split, verified observations, open gates, and exactly one next action.
- `gates.md` owns human, capability, product-decision, and external-write gates.
- `artifacts.md` indexes canonical artifacts by type, owner skill, exact branch/SHA or URL, and disposition.
- `events/*.md` records worker, QA, review, promotion, feedback, sync, or finalization evidence tied to exact SHAs.
- `archive/**/summary.md` retains the compressed outcome, final refs, evidence pointers, and retained development tag after active details leave the ledger tip.

Treat records as claims. Verify Git state before acting and provider state only when the next action depends on it. Never store tokens, secrets, full untrusted comments, or secret-bearing output.

## Private context lifecycle

Before lane work, resolve `HEAD:.slipway/context` in the bound ledger and
validate `manifest.yaml` plus every selected module entrypoint. IDs and paths
must be unique and relative; entrypoints and supporting files must be regular,
non-empty files inside the context tree. Reject traversal, symlinks, executable
entries, duplicate IDs, unknown fields that change execution, or any command or
hook declaration. Treat the tree ID as opaque.

Cache only a validated canonical tree under `.slipway-local/context/`. A fresh
or missing cache may hydrate normally. A stale cache may update only when its
recorded tree resolves to a prior `.slipway/context` tree in the bound ledger
history and every existing cached path still matches that baseline. Never
overwrite divergent local bytes. Audit the complete cache before recording
`.slipway-local/context.version`; preserve unrelated repository-local exclude
entries. Invalid, divergent, unexpected, or tracked cache state blocks lane
work with exactly one repair action in the explicit project-policy/setup
window.

### Context operation mapping

Use this mapping for module selection and active-run migration; do not invent an
operation from a free-form phase label. Apart from the special manifest value
`all`, the operation vocabulary is `development`, `diagnosis`, `research`,
`prototype`, and `review`.

| Current route | Manifest operation |
| --- | --- |
| `setup`, `tiny-change`, `small-development`, `large-development`, `bug-fix`, or implementation of accepted delivery feedback | `development` |
| `bug-investigation` | `diagnosis` |
| Research-only or prototype-only route | `research` or `prototype`, respectively; when both routes are active, evaluate both and use the union of selected modules |
| `review-only`, QA, exact-SHA review, agentic-PR work, promotion, synchronization, finalization, or delivery-feedback assessment/monitoring | `review` |
| Classification before one of the routes above | The prospective route's mapped operation |
| `session-continuity` or a paused run | The operation mapped from the run's single recorded next action |
| Forced `status` | No module activation; validate context and report the stored selection |

A module with `operations: [all]` applies to every mapped operation. If the
recorded phase and next action map differently or do not identify one route,
block and reconcile the run record before selecting modules or completing
migration.

After the cache is healthy, resolve modules for the current operation. A module
applies only when its operation matches, every repository marker exists, and
every declared capability is available. A missing required module or
capability blocks. Skip an unavailable optional module and report the reason.
Record the context tree ID plus activated and skipped module IDs in run status.

Load each activated entrypoint explicitly before its target acts. The
coordinator loads coordinator-targeted modules before classification or
delegation. Worker and reviewer briefs name the exact tree ID, module IDs, and
entrypoints selected for that recipient; the recipient reads them before work.
If the recipient cannot access the ignored cache, the coordinator includes the
selected context in the brief. Slipway core safety, cargo, repository identity,
exact-SHA review, and external-write gates always take precedence. Context may
augment those rules but cannot weaken them; an ambiguous conflict blocks.

Re-check after worktree creation, resume, accepted context changes, and only
after clean agentic main fast-forwards from authoritative delivery main. Status
is read-only: it validates and reports the current or scoped local cache but
does not hydrate, repair, activate lane modules, or execute lane work. For an
inaccessible worktree, report stored timestamped context observations and mark
them unverified from this host.

## Pause and resume

Pause after the current atomic Git operation. Drain or account for every worker result, update coordinator-owned files, commit the run path, and name one next action. A pause is safe only when a fresh session can resume without the chat.

Resume by reading project/preferences, the run manifest/status/gates/artifacts, and all events newer than the last reconciled event. Verify the branch and recorded SHAs. Reconcile discrepancies as new facts; never rewrite history or treat a stale exact-SHA verdict as current.
