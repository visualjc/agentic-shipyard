# Synchronization

`shipyard-sync` is a baseline-only operation. It fast-forwards a clean local
development `main` to the bound destination `main`, or imports one explicitly
named destination branch, tag, or ref into `refs/shipyard/source/...`.

The command verifies the token's GitHub viewer against the bound profile actor
before any credentialed Git child. Credentialed fetch and lookup run only in a
temporary bare repository whose config contains the exact bound destination;
the product repository imports the verified object afterward without a token.
After staging, and again before each object, ref, index, worktree, or ledger
mutation, Shipyard re-resolves the binding and profile authorization, actor,
topology, remote, clean local Git facts, and path ownership. The local adapter
also checks the exact expected branch, development ref, destination-tracking
ref, remote URL, and object format at the mutation boundary.

It never promotes, finalizes, merges, rebases, resets, repairs feature work, or
pushes. A dirty worktree, changed remote identity, non-fast-forward ancestry,
ambiguous path ownership, unsafe source name, stale provenance, or uncertain
lock state stops the operation. Clean or inspect the reported condition and
run a new explicit command; Shipyard does not retry or repair it automatically.

For a validated clean fast-forward, the local adapter first fetches only the
verified object, without creating a temporary ref. It prepares one Git ref
transaction for development `main` and its destination-tracking ref, applies
the exact staged tree while those expected-old-SHA locks are held, and commits
both refs together. A bounded transaction child, tree-application failure, or
ref race aborts and restores the pre-operation state. It does not invoke
`git merge`, hooks, conflict resolution, or a ref rewrite outside that exact
fast-forward.

Source refs are local policy-read-only objects. Before using one, resolve the
same bound destination remote and requested name again and require its exact
recorded SHA plus the pinned receipt and current canonical ledger bytes. A new
source receipt becomes durable before the local source ref is created. If that
first ref creation fails, rerun the identical explicit import to resume; if an
older immutable ref names another SHA, Shipyard preserves its canonical record
and stops before writing the ledger. Source refs are never included in
Shipyard product publication refspecs.

A moved authoritative source never replaces its prior canonical provenance,
even if the corresponding local source ref was deleted. Only the same exact
SHA can resume a missing local source ref from the already verified receipt.
All local and authenticated Git children have fixed time and output bounds and
return bounded redacted diagnostics on failure.

The deterministic port matrix covers both full SHA-1 and SHA-256 object IDs.
On this macOS Git build, remote SHA-256 receive is unsupported, so the real
disposable-remote SHA-256 case is reported as a platform skip while the same
acceptance logic is exercised through the deterministic fake Git port.
