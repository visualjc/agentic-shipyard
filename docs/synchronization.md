# Synchronization

`shipyard-sync` is a baseline-only operation. It fast-forwards a clean local
development `main` to the bound destination `main`, or imports one explicitly
named destination branch, tag, or ref into `refs/shipyard/source/...`.

The command verifies the token's GitHub viewer against the bound profile actor
before any credentialed Git child. Credentialed fetch and lookup run only in a
temporary bare repository whose config contains the exact bound destination;
the product repository imports the verified object afterward without a token.

It never promotes, finalizes, merges, rebases, resets, repairs feature work, or
pushes. A dirty worktree, changed remote identity, non-fast-forward ancestry,
ambiguous path ownership, unsafe source name, stale provenance, or uncertain
lock state stops the operation. Clean or inspect the reported condition and
run a new explicit command; Shipyard does not retry or repair it automatically.

For a validated clean fast-forward, the local adapter applies the exact staged
tree with Git plumbing and advances `main` with an expected-old-SHA compare and
swap. It does not invoke `git merge`, hooks, conflict resolution, or a ref
rewrite outside that exact fast-forward.

Source refs are local policy-read-only objects. Before using one, resolve the
same bound destination remote and requested name again and require its exact
recorded SHA. They are never included in Shipyard product publication refspecs.

The deterministic port matrix covers both full SHA-1 and SHA-256 object IDs.
On this macOS Git build, remote SHA-256 receive is unsupported, so the real
disposable-remote SHA-256 case is reported as a platform skip while the same
acceptance logic is exercised through the deterministic fake Git port.
