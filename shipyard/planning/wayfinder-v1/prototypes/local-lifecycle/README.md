# Disposable local lifecycle prototype

This prototype answers Wayfinder ticket 12 with generated local Git
repositories. It does not contact GitHub, inspect production code, install a
skill, or change an existing repository.

Run it with Node 22 or newer:

```sh
node prototype.mjs
```

The command creates two temporary bare repositories, paired working clones, a
feature worktree, a separate orphan ledger worktree, and machine-local binding
state. It renders every invariant as `PASS` or `FAIL`, removes the temporary lab
on success or failure, and exits non-zero if any expected guard or lifecycle
step does not behave as specified.

Use `node prototype.mjs --keep` only when inspecting the generated lab. The
printed temporary path must then be removed manually.

This is disposable design evidence, not production Shipyard code. In
particular, the local JSON files stand in for future schemas, and copying
classified paths between working trees stands in for a hardened payload
builder.

