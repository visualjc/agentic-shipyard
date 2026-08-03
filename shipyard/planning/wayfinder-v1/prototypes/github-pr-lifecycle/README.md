# Disposable GitHub staged-pair prototype

This one-shot exercise uses only these approved private fixtures:

- `visualjc/shipyard-fixture-staged`
- `NativeInteractive/shipyard-fixture-staged`

It obtains the stored `visualjc` token explicitly for every GitHub operation and
never changes the globally active GitHub CLI account. Git pushes use an
ephemeral askpass helper whose token exists only in the child-process
environment.

The exercise seeds synthetic code, runs independent Codex review processes,
creates and revises a development PR, promotes sanitized commits to a normal
destination-owned PR, simulates the destination merge, preserves the
development-only ledger/tag, synchronizes `main`, and closes the development PR
without merging it.

It is intentionally one-shot and refuses to seed non-empty fixtures:

```sh
node prototype.mjs --exercise
```

The GitHub repositories are retained after the run until the findings are
accepted. Local temporary clones are removed.
