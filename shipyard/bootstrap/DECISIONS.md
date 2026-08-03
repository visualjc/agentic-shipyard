# Agentic Shipyard bootstrap decisions

Updated: 2026-08-03T23:28:55Z

This log records decisions made while Jim was AFK. It describes bootstrap
policy, not settled behavior beyond the Shipyard v1 PRD.

## D-001 — Repository identity

Use the product name **Shipyard**, the repository name `agentic-shipyard`, and a
one-to-one staged pair:

- development: `visualjc/agentic-shipyard`;
- destination: `NativeInteractive/agentic-shipyard`.

Both begin private. `NativeInteractive` is authoritative for clean `main`;
VisualJC is authoritative for agentic planning, issues, development PRs,
ledger records, and exact reviewed SHAs.

## D-002 — CCPM storage capability

The maintained CCPM pin
`cdb97474904ab2cdc7d391aa17393b444a28be3e` does not contain a configurable
project-data root. Its skill contract explicitly requires `.claude/`, and 23
skill/reference/script files contain hardcoded `.claude/` paths.

Do not patch or silently fork the dependency during bootstrap. A configurable
CCPM root remains a later upstream/fork improvement.

## D-003 — Ledger-backed CCPM bridge

Canonical CCPM state lives at `shipyard/ccpm/` on the development-only
`shipyard-ledger` branch. A guarded bootstrap creates an ignored machine-local
`.claude` symlink in the development clone pointing to that directory. This
lets the pinned CCPM scripts use their expected path while physical writes land
on the ledger worktree.

The bridge refuses an unexpected origin, extra remote, wrong ledger branch,
different Git common directory, or pre-existing `.claude` path that is not the
exact expected symlink. It never writes `.claude` to product history.

## D-004 — GitHub issue authority

All CCPM epic/task issues are created only in
`visualjc/agentic-shipyard`. The destination repository receives no internal
workflow issue. Bootstrap issue sync uses the command-scoped `visualjc`
credential, verifies the API login, and never changes the global active account.

Raw CCPM `gh` commands are not trusted for bootstrap because they infer the
target from `origin` and do not implement Shipyard's actor/allowlist policy.

## D-005 — Repository bootstrap history

Create the destination repository first and seed one minimal product commit.
Copy that exact commit to development `main` without retaining a destination
remote. The existing local `computer-management/shipyard` directory becomes the
VisualJC development clone; current premise, Wayfinder, prototype, and bootstrap
files remain local/excluded and are copied into the ledger.

## D-006 — Implementation architecture for decomposition

Plan one TypeScript ESM package with a Node 22 minimum for the core CLI and
skills. Keep pure state/policy logic separate from Git, GitHub, Codex, and graph
adapters. Node 24 remains an adapter-specific requirement for the proven
CodeGraph/FTS5 combination, not a universal Shipyard runtime.

## D-007 — CCPM task boundary

Decompose the PRD into ten vertical tasks: foundation/binding, ledger/context,
scoped GitHub tracking, sync, acceptance/review, staged-pair delivery,
single-repository delivery, orchestration/toolchain, experimental graphs, and
end-to-end hardening/release evidence. Do not begin implementation during this
bootstrap.

## D-008 — Live host boundary

Use Codex only for independent plan review. Do not invoke Claude Code or Cursor
while their authenticated identities remain outside this bootstrap boundary.

## D-009 — Existing fixtures

Do not rename or reuse `shipyard-fixture-staged`. Those repositories remain
disposable lifecycle evidence until Jim accepts their findings and separately
authorizes deletion.

## D-010 — Independent decomposition review

An ephemeral read-only Codex review returned `revise` before issue creation. Its
four blocking findings were accepted:

- task 002 now owns the complete delivery workspace (feature branch, linked
  worktree, delivery ID, and ledger entry), including the prohibition on product
  work on `main`;
- task 001 now owns the shared one-owner path classifier, mutation-lock
  primitive, and extensible status projection; sync/promotion/finalization tasks
  explicitly revalidate policy;
- task 008 integrates all slice-specific status/provider checkpoint fields; and
- task 007 now depends on task 006 and reuses its shared topology
  dispatcher/manifests instead of declaring an unordered conflict.

Non-blocking recommendations were also adopted where they clarified provider
checkpoint integration, staged-pair milestones, and the Codex-only CCPM path.
A second independent Codex gate returned `pass`, with all four findings resolved
and issue synchronization judged safe only for `visualjc/agentic-shipyard`.
