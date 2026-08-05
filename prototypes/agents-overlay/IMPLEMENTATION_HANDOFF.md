# Agentic overlay implementation handoff

## Mission

Turn the accepted agent-overlay prototype into Slipway's production Markdown
contract. Preserve Slipway's defining boundary: the delivery repository remains
skill-agnostic while the paired agentic repository receives durable private
agent policy from the ledger.

Work on branch `codex/agentic-overlay-extension`, starting from
`ff73597982b6347a82de5d18992c874385b3e6d9`. Do not push, modify remotes,
touch the delivery repository, or edit the ledger worktree. Do not commit; the
orchestrator will review and commit the integrated change.

## Accepted design

The accepted strategy is the ledger-backed ignored worktree overlay described
in `prototypes/agents-overlay/FINDINGS.md`.

- Repo A may have a minimal, skill-agnostic `AGENTS.md` extension line and a
  `CLAUDE.md` shim containing `@AGENTS.md`.
- Repo B receives private `AGENTS.local.md`, `CLAUDE.local.md`, and
  `docs/agents/**` files from the parallel Slipway ledger.
- `CLAUDE.local.md` is only an adapter containing `@AGENTS.local.md`.
- The canonical default `AGENTS.local.md` establishes the private metadata
  boundary and tells `setup-matt-pocock-skills` output to target the private
  overlay rather than tracked `AGENTS.md` or `CLAUDE.md`.
- Private overlay paths are excluded through each Repo-B worktree's
  repository-local Git exclude. Do not add them to a shared `.gitignore`.
- Hydration is mandatory, idempotent, versioned, verified, and fail-closed.
- Never use `skip-worktree` or `assume-unchanged`.
- Exact product cargo must never contain private overlay files or policy.

## Required product changes

### 1. Reusable assets

Add canonical seed assets under the primary `slipway` skill:

- a private-overlay manifest template;
- a default `AGENTS.local.md` containing the general boundary and explicit
  Matt-setup redirection rules;
- a `CLAUDE.local.md` containing only `@AGENTS.local.md`.

Use a layout that cleanly distinguishes ledger metadata from materialized
files. The ledger overlay must support additional `docs/agents/**` files added
by setup or later project-policy updates.

### 2. Durable-store and setup contracts

Extend `references/store.md`, `references/setup.md`, binding/project assets as
needed, and the setup direct-entry skill so that:

- the ledger owns one project-wide canonical overlay;
- the overlay version is the Git tree object ID for the canonical overlay
  directory (`HEAD:.slipway/agent-overlay`), not the ledger branch HEAD, so
  unrelated run commits do not make every worktree stale;
- setup proposes and confirms the public extension contract separately from
  private policy;
- setup seeds the private overlay and materializes it only in Repo B;
- local state records the hydrated overlay tree ID;
- setup remains read-only until its existing confirmation gate.

### 3. Hydration and lifecycle

Update the run-start contract and every lifecycle entry that can create,
resume, synchronize, or inspect an agentic worktree. The instructions must
require:

1. resolve the canonical overlay tree ID from the ledger;
2. validate the manifest and destination allowlist;
3. add only the materialized private paths to that worktree's Git exclude;
4. hydrate missing files;
5. record the tree ID under `.slipway-local/`;
6. compare materialized bytes with canonical ledger bytes;
7. fail closed on missing, stale, unexpected, tracked, or locally divergent
   files, with exactly one repair action;
8. never overwrite divergent local edits automatically.

Re-check after worktree creation, resume, authoritative-main synchronization,
and accepted project-policy changes. Status should surface overlay health
without requiring delivery capabilities.

### 4. Matt setup adapter

Replace the existing requirement to commit Matt's setup output on each work
branch. The production contract must:

- hydrate the default overlay before Matt setup;
- allow Matt setup discovery, questions, and confirmed draft generation;
- intercept its normal write destination because it prefers tracked
  `CLAUDE.md`, then `AGENTS.md`;
- persist proposed instruction additions into canonical `AGENTS.local.md` and
  supporting output into private `docs/agents/**`;
- update the ledger overlay in an explicit project-policy/setup window;
- rehydrate and verify the current worktree;
- keep `CLAUDE.local.md` as the one-line adapter;
- mark Matt project setup complete only after ledger persistence and local
  verification succeed.

The text in `AGENTS.local.md` is defense in depth. Slipway's interception and
cargo checks remain the enforcement contract.

### 5. Cargo, review, promotion, and synchronization

Strengthen relevant references/playbooks/direct skills so that overlay files
and private markers are rejected from tracked agentic commits, agentic PR
cargo, and delivery promotion. Synchronization must rehydrate only after clean
agentic main has been fast-forwarded from authoritative delivery main.

### 6. Product documentation and validation

Update the specification, architecture, distribution/setup documentation, and
validation record to explain the feature without claiming host behavior that
has not been tested. Preserve the source-only, Markdown/YAML-only product.

Extend the throwaway harness only if needed to cover a production invariant.
At minimum, run its existing one-command validation and retain its distinction
between verified Codex behavior and still-unverified fresh Claude behavior.

## Acceptance criteria

- Repo A can remain free of Matt, CodeGraph, understand-anything, and other
  private skill assumptions.
- The default ledger overlay tells all private setup tools, including Matt
  setup, to persist policy privately.
- Claude receives shared policy through tracked `CLAUDE.md -> AGENTS.md` and
  private policy through ignored `CLAUDE.local.md -> AGENTS.local.md`, without
  duplicating the policy text.
- A fresh or resumed Repo-B worktree cannot enter lane work with an absent,
  stale, tracked, or byte-divergent overlay.
- Unrelated ledger commits do not invalidate a hydrated overlay version.
- No lifecycle instruction still directs Matt setup output into a per-run
  metadata commit.
- Promotion and delivery-gate instructions explicitly reject overlay leakage.
- All Markdown links resolve, all skill validators pass, YAML parses,
  `git diff --check` passes, and `prototypes/agents-overlay/run.sh` passes.
- No scripts, executables, services, schemas, or runtime helpers are added to
  `packages/slipway/`.

## Report

Return the files changed, key policy decisions, exact verification commands and
results, and any unresolved limitations. Do not commit or push.
