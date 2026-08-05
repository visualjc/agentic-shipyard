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

The observed comparison and recommendation are captured in
[FINDINGS.md](FINDINGS.md).

It uses only `bash` and Git, creates its paired trivia-app repositories under a
new `mktemp` directory, and prints that directory at the end for inspection.
Nothing under the real project is modified. To retain fixtures at a known path,
pass it as the first argument (it must be an empty/new disposable directory).

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
