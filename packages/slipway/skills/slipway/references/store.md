# Durable store

Slipway uses Git-backed Markdown records without a runtime or shared database.

## Locations

The ignored agentic-worktree file `.slipway-local/binding.md` locates the paired repositories and dedicated ledger worktree. Portable state lives only on the parallel `slipway-ledger` branch:

```text
.slipway/
  project.md
  preferences.md
  agent-overlay/
    manifest.md
    AGENTS.local.md
    CLAUDE.local.md
    docs/agents/**
  runs/<complete-work-branch>/
    manifest.md
    status.md
    gates.md
    artifacts.md
    events/*.md
  archive/<complete-work-branch>/summary.md
  portfolio.md
```

The ledger owns exactly one project-wide canonical private overlay at
`.slipway/agent-overlay/`; it is not a run shard and never belongs in product
ancestry. Its version is the Git **tree object ID** for
`HEAD:.slipway/agent-overlay`, not the ledger branch HEAD, so unrelated run
records do not make a healthy worktree stale. The canonical manifest requires
`manifest.md`, `AGENTS.local.md`, and `CLAUDE.local.md` as canonical regular
file sources, and allowlists only materialized `AGENTS.local.md`,
`CLAUDE.local.md`, and optional `docs/agents/**`; `manifest.md` is not itself
materialized. The canonical seed assets are in `assets/agent-overlay/`.

Every Repo-B worktree records the hydrated tree ID in ignored
`.slipway-local/agent-overlay.version`. The Repo-B clone's repository-local Git
exclude, shared by its linked worktrees, must contain these materialized private
paths and local state:
`/AGENTS.local.md`, `/CLAUDE.local.md`, `/docs/agents/`, and
`/.slipway-local/`. Slipway may manage only those four patterns and must
preserve unrelated existing exclusions. Never add these paths to shared
`.gitignore`, and never use `skip-worktree` or `assume-unchanged`.

Branch slashes intentionally create nested directories. Discover runs recursively by finding `manifest.md`; read the canonical branch from the manifest rather than inferring it from directory depth. `portfolio.md` is an optional derived snapshot, not write authority.

## Identity

Validate a proposed run name with `git check-ref-format --branch`. Require the full agentic work-branch name, one active run per branch, and no prior run or archive using that name. Recursively read every active manifest and reject a candidate when either branch name is a slash-delimited path prefix of the other, such as `feature/a` and `feature/a/b`; run shard paths must remain disjoint even if refs are packed or stale. Never reuse a work-branch name.

A rename is a migration, not a fresh run. Verify old and new refs, confirm the new name has never been used, move the shard to the matching path, record `Former branch`, update every branch pointer, commit the ledger migration, then rename or verify the agentic branch. Stop if either side cannot be made consistent without discarding work.

Pstack worker branches and ticket branches are units within the parent run. They do not create top-level Slipway run shards unless the user explicitly starts an independent delivery.

## Writers

One run coordinator owns `manifest.md`, `status.md`, `gates.md`, and `artifacts.md`. Workers and reviewers must not edit those files. They add one immutable event with a unique name such as `20260804T231500Z-review-agent7-a1b2.md`. Never replace or delete an event before finalization.

Different runs own disjoint paths. Stage only explicit files and never use `git add .` in the ledger worktree. A worker stages and commits only its new event file. A coordinator names its owned summary files and the exact reconciled events explicitly. Prefer `git commit --only -- <exact-path>...` so another run or worker's staged paths cannot enter the commit.

Git serializes index and ref updates. If an index or ref lock is busy, stop the current Git operation, re-read ledger HEAD and status, and retry the exact scoped operation. Never delete a lock automatically. A failed ref update requires rebasing the pending record on the new ledger HEAD and rechecking the path; do not overwrite another run.

Global project, preferences, or agent-overlay changes require an explicit setup
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

## Overlay lifecycle

Hydration is mandatory, idempotent, and fail-closed. Resolve the current ledger
overlay tree and validate its canonical manifest, format, required sources,
allowlist, file modes, and destinations before any target write. `AGENTS.local.md`
and `CLAUDE.local.md` must be non-empty, and `CLAUDE.local.md` bytes must be
exactly `@AGENTS.local.md` followed by one LF. A required source that is
missing, duplicated, empty, or has an invalid mode; an invalid canonical
manifest; or a Claude adapter mismatch always blocks. Missing materialization
in a fresh worktree is different: when no version is recorded, every existing
managed node must be absent or match the current canonical tree exactly;
Slipway may then install the missing current files and record that tree ID.
When the recorded tree ID equals the current canonical tree but materialization
is incomplete, every existing managed node, type, and byte must likewise match
the current canonical manifest. Only then may Slipway restore the missing
current files. In both fresh and current-version cases, unexpected, invalid, or
tracked nodes prevent safe hydration.

When the recorded tree ID differs from the current canonical tree, accept it
as a baseline only if it resolves to a tree reachable as a prior
`.slipway/agent-overlay` value in the bound ledger history. Load that historical
tree and apply the same canonical manifest, format, required-source, allowlist,
file-mode, and destination validation used for the current tree. Reachability
alone does not establish ownership. Before writing, validate the tracked state
and every existing managed node, type, and byte against the paths owned by that
validated historical manifest. An obsolete path may be removed only when the
historical manifest owns it and its local type and bytes still match that
baseline. After this complete preflight, stage and install the current
canonical state, preserving unrelated repository-local exclusions. Audit the
complete allowlisted materialization, including the absence of obsolete or
unexpected nodes, before advancing
`.slipway-local/agent-overlay.version`; then reverify the bytes, version, and
exclude state. Recovery from a failed write is best-effort and does not make an
unaudited worktree healthy.

Classify the live worktree only after the complete no-write preflight. Current
bytes and version are `healthy` with action `none`. Safe materialization
absence is `missing` with action `hydrate`; a safe validated historical
baseline is `stale` with action `hydrate`. Those states are hydration-ready
only after every no-write safety condition above passes. Hydration is normal
worktree lifecycle preparation, not manual repair, and a successfully hydrated
worktree becomes `healthy` with action `none` before lane work.

A missing, duplicated, empty, invalid-mode, or adapter-mismatched current or
historical required canonical source, invalid current or historical canonical
manifest, invalid or unreachable recorded ID, invalid node or mode is
`invalid`; a prior-byte or ownership mismatch is `divergent`; an unowned node
is `unexpected`; and a tracked private path is `tracked`. These unsafe states
use action `repair`.
Never overwrite a divergent local edit automatically. An unresolved unsafe
state blocks lane work with exactly one manual repair action: reconcile the
private files, or deliberately remove and recreate them, in the explicit
project-policy/setup window; then rehydrate and verify.

Re-check after worktree creation, resume, accepted project-policy changes, and
only after clean agentic main fast-forwards from authoritative delivery main.
Status is read-only and needs no delivery capability; it must not invoke setup,
hydrate, repair, or execute lane work. When the host can read the current or
explicitly scoped local Repo-B worktree, perform the complete no-write
preflight above and report its health, action, and hydrated tree ID. Report
`missing` or `stale` with action `hydrate` only when the preflight proves that
normal hydration is safe; otherwise report the corresponding unsafe health
with action `repair`. For every other worktree, report its stored timestamped
`Worktree overlay health` and `Worktree overlay action` observations and
explicitly mark both unverified from this host.

## Pause and resume

Pause after the current atomic Git operation. Drain or account for every worker result, update coordinator-owned files, commit the run path, and name one next action. A pause is safe only when a fresh session can resume without the chat.

Resume by reading project/preferences, the run manifest/status/gates/artifacts, and all events newer than the last reconciled event. Verify the branch and recorded SHAs. Reconcile discrepancies as new facts; never rewrite history or treat a stale exact-SHA verdict as current.
