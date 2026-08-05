# Agentic overlay prototype findings

## Verdict

Use the shared optional `AGENTS.local.md` extension point with a **ledger-backed,
ignored Repo-B overlay**. Make hydration and freshness verification a mandatory
Slipway run-start gate. Until that gate exists, the per-run metadata commit is
the safer fallback. Do not introduce a long-lived agentic overlay branch.

## What was exercised

The one-command harness created three independent paired trivia repositories and
ran the same delivery lifecycle through each strategy:

1. Per-run committed metadata.
2. A long-lived committed `agentic-overlay` base branch.
3. A ledger-backed ignored worktree overlay.

Each strategy created two concurrent work branches, used the confirmed Matt
setup answers (local Markdown tracker, default triage labels, single-context
domain docs), promoted one exact product commit, changed Repo A's public
`AGENTS.md`, and synchronized Repo B main.

All three strategies proved that exact product-only promotion can keep
`AGENTS.local.md` and `docs/agents/**` out of Repo A. Additional assertions also
found no private overlay markers in Repo A's tracked instruction files.

Fresh `gpt-5.6-luna` agents at low reasoning effort then probed the generated
repositories:

- Repo A reported no configured Matt tracker, labels, domain policy, or private
  skills.
- Each hydrated Repo B variant recovered the local tracker, five exact labels,
  single-context domain layout, and private skill assumptions.
- A clean unhydrated Repo B clone reported the private setup missing.
- After ledger hydration, a fresh Repo B agent also recovered newly added
  optional CodeGraph guidance while confirming that the overlay was ignored and
  untracked.

## Strategy comparison

### 1. Per-run metadata commit

**Pros**

- Git makes the exact instructions reproducible and auditable.
- Fresh worktrees created from the feature branch receive the configuration
  automatically.
- Recovery is straightforward because private state is in branch history.
- Exact product-only commit selection kept all private paths out of Repo A.

**Cons**

- Every run repeats effectively identical metadata commits.
- Private scaffolding appears in every Repo-B branch and agentic PR.
- Concurrent runs can carry different policy versions.
- Repo A changes to its public `AGENTS.md` require each active work branch to
  reconcile its base separately.

**Assessment:** safe and understandable, but noisy. Keep as the fallback when
automatic hydration cannot be trusted.

### 2. Long-lived overlay branch

**Pros**

- New branches from the overlay receive private guidance immediately.
- One branch centralizes the committed policy history.
- Fresh machines can recover the overlay by selecting the special branch.

**Cons**

- Adds another long-lived branch with its own synchronization lifecycle.
- Every delivery-main update requires rebuilding or rebasing the overlay.
- The prototype required a force-with-lease update after synchronization.
- Existing feature branches remain based on the old overlay commit after that
  rewrite and need separate reconciliation.
- The distinction between clean agentic main, overlay base, and feature base
  makes ancestry and review harder to explain.

**Assessment:** reject. It solves file availability by creating a larger Git
coordination problem.

### 3. Ledger-backed ignored worktree overlay

**Pros**

- Repo B main remains an exact mirror of Repo A main.
- Feature histories and agentic PRs contain only actual run commits.
- Private policy changes do not create rebase conflicts with Repo A's public
  `AGENTS.md`.
- Concurrent runs can hydrate the same exact ledger version without shared
  branch ancestry.
- The prototype demonstrated idempotent hydration, exact ledger-version
  recording, stale-policy detection, fresh-machine reconstruction, recovery
  after a policy update, and rehydration after main synchronization.
- Repo-local Git excludes kept status clean without modifying Repo A's tracked
  `.gitignore`.

**Cons**

- A new worktree or machine starts without private guidance until Slipway
  hydrates it.
- Ignored files are invisible to ordinary Git history and status.
- A missing or stale overlay can silently reduce agent capability unless
  run-start fails closed.
- Host-specific instruction behavior still needs validation. The prototype
  verified fresh Codex behavior but not Claude Code or every supported host.

**Assessment:** best fit for Slipway's defining boundary, provided hydration is
treated as required lifecycle machinery rather than a convenience.

## Recommended contract

Repo A may contain only a generic, skill-agnostic extension point:

```markdown
When `AGENTS.local.md` exists, read it before work. It is private Repo-B
guidance; do not commit, promote, or require it in the delivery repository.
```

Repo B's ledger should own the canonical private overlay and its exact version:

```text
.slipway/agent-overlay/
  AGENTS.local.md
  docs/agents/issue-tracker.md
  docs/agents/triage-labels.md
  docs/agents/domain.md
  manifest.md
```

Before any planning, diagnosis, research, prototype, or implementation lane,
Slipway run-start should:

1. Resolve and verify the canonical ledger overlay version.
2. Materialize the files into the exact Repo-B worktree.
3. Add only the private paths to the repository-local Git exclude.
4. Record the hydrated version under `.slipway-local/`.
5. Compare the materialized files and version with the ledger.
6. Stop with one repair action when anything is missing, stale, or different.
7. Repeat the check after worktree creation, main synchronization, and an
   accepted project-policy change.

Hydration must be idempotent. It must not use `skip-worktree`,
`assume-unchanged`, or other hidden index flags.

## Matt setup integration

The current `setup-matt-pocock-skills` skill edits `CLAUDE.md` whenever it
exists, otherwise `AGENTS.md`; it does not target `AGENTS.local.md`. Slipway
should therefore let the skill perform discovery and produce its confirmed
draft, then persist that draft through the private-overlay adapter. Directly
allowing the unmodified write phase would put private assumptions into tracked
Repo-A-compatible files.

## Remaining validation

- Confirm the extension behavior in Claude Code and any other supported host.
- Decide the durable overlay manifest format and content-hash rules.
- Define whether manual edits to hydrated files are rejected, imported back
  into the ledger, or overwritten after explicit confirmation.
- Validate the design against a real paired project and provider workflow.
