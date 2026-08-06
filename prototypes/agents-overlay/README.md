# PROTOTYPE — Agentic overlay Git topology

**Throwaway harness, not Slipway production code.** It answers one question:

> Can Repo A remain skill-agnostic while Repo B reliably supplies private Matt
> setup instructions (`AGENTS.local.md`, `CLAUDE.local.md`, and
> `docs/agents/**`) across concurrent runs, delivery sync, and a fresh machine,
> without private paths entering delivery cargo?

Run it from this repository with one command:

```sh
./prototypes/agents-overlay/run.sh
```

To exercise Git's SHA-256 object format explicitly:

```sh
GIT_DEFAULT_HASH=sha256 ./prototypes/agents-overlay/run.sh
```

The observed comparison and recommendation are captured in
[FINDINGS.md](FINDINGS.md).

The harness also runs [verify-contract.sh](verify-contract.sh), a small
table-driven guard against inverted safety prose in the product contract. It
runs self-tests that append contradictory variants as bullets, soft-wrapped
task-list items, and mid-paragraph clauses and require failure before checking
the candidate contract.
Host-specific Codex evidence is recorded separately in
[CODEX-PROBES.md](CODEX-PROBES.md); it is reproducible evidence, not a claim
that the shell harness launched an agent host.

It uses `bash`, Git, and standard Unix utilities. With no argument, it creates
its paired trivia-app repositories under a new `mktemp` directory and prints
that directory at the end for inspection; this default path does not modify the
real project. A caller may instead pass an empty/new disposable directory as
the first argument. The harness writes directly beneath a caller-supplied path,
so the caller is responsible for ensuring that path is safe and disposable.

The shared delivery fixture has a minimal `AGENTS.md` that says to read an
optional `AGENTS.local.md` when present and a `CLAUDE.md` containing `@AGENTS.md`.
The private overlay adds a `CLAUDE.local.md` containing only
`@AGENTS.local.md` and uses the requested Matt answers: local Markdown tracker,
default triage labels, and single-context domain documentation.

## Three strategies exercised

1. **Per-run committed metadata:** each feature branch commits the private
   overlay before product work.
2. **Long-lived overlay branch:** feature branches begin from one committed
   `agentic-overlay` branch.
3. **Ledger-backed ignored overlay:** private files stay untracked and ignored
   in each worktree, then are copied from a private ledger checkout at run start.

For every strategy the harness creates two concurrent feature branches, adds a
product change, cherry-picks only the exact product commit to Repo A, asserts
that its cargo contains no `AGENTS.local.md`, `CLAUDE.local.md`, or
`docs/agents/**`, changes Repo A's public `AGENTS.md`, syncs Repo B main, and
tests a fresh worktree or second-machine reconstruction.

The ledger-backed strategy also exercises fail-closed hydration: divergent
local bytes, unexpected materialized paths, and tracked private files are
rejected without changing the attempted state; a reachable stale version
advances only when every existing byte still matches its recorded prior tree.
Its manifest fixture is copied from the product asset. A deterministic
post-install fault verifies best-effort rollback of the complete managed-content
and managed-path pre-state, including absence, bytes, node types, version, and
the full clone-local exclude. It does not preserve or claim inode or hardlink
metadata. The harness does not claim filesystem transaction atomicity;
concurrent external mutation during hydration is outside this prototype's
scope.

## Reading the output

`PASS ... cargo` is the hard safety invariant: private metadata did not enter
Repo A. The branch graphs and private-path listings show the human-facing cost.

- Strategy 1 makes each branch self-contained, but repeats metadata commits.
- Strategy 2 removes repeated setup commits, but requires rebasing and force
  pushing a durable private base after delivery-main sync.
- Strategy 3 keeps Repo B Git history cleanest, but demonstrates the key
  operational dependency: a new machine has no overlay until Slipway explicitly
  hydrates it from the ledger.

The harness intentionally models only Git topology and file visibility. It does
not prove that every agent host recursively obeys a reference from `AGENTS.md`,
nor does it integrate with a real provider, PR system, or Slipway promotion
implementation.
