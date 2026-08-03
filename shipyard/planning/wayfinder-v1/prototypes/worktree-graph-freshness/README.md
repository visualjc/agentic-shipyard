# Disposable worktree graph-freshness prototype

Question: which graph adapters can reuse an exact-`main` baseline while keeping
divergent worktrees independently fresh across edits, commits, rebases,
checkouts, process restarts, and worktree recreation?

Run the synthetic tool exercise:

```sh
node prototype.mjs --exercise
```

The first run may build temporary exact-source environments for CodeGraph,
Graphify, and Understand Anything. Dependency caches and the generated Git
fixture live under one temporary directory and are removed afterward. Set
`--keep` only to inspect that directory.

Explore the tool-independent freshness state by hand:

```sh
node prototype.mjs
```

The exercise disables CodeGraph telemetry and Graphify query logging, invokes
Graphify only with `--code-only`, and invokes only Understand Anything's
deterministic local scanner. It does not call an LLM or inspect proprietary
code.

This is disposable evidence. The adapter state and output parsing are not
production implementations.

