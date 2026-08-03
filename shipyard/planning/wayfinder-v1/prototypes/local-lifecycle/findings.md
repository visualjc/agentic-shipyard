# Findings: disposable local Shipyard lifecycle

Status: complete  
Executed: 2026-08-03  
Prototype: [`prototype.mjs`](prototype.mjs)

## Result

The generated local staged-pair lab passed all 29 assertions and removed its
temporary repositories. The settled Git/ref model is mechanically viable
without GitHub or production code.

The prototype created:

- independent bare development and destination repositories;
- paired working clones whose clean `main` branches became byte-for-byte the
  same commit;
- one linked product worktree and one parallel orphan ledger worktree;
- machine-local profile binding, source-ref provenance, and mutation locks;
- an exact-SHA acceptance/review record;
- a two-revision sanitized destination branch;
- a destination-only human merge simulation; and
- a development-only annotated reviewed tag plus retained ledger branch.

No existing repository, remote, account, GitHub resource, installed skill, or
production source tree was read or changed.

## Proven mechanics

### Binding and fail-closed guards

A binding keyed by Git's shared common directory resolved identically from the
main development clone and its linked feature worktree. The lab rejected:

- a dirty baseline;
- divergent commits;
- two bindings for the same common directory;
- a binding whose development origin no longer matched;
- an unclassified changed path;
- a path matched by conflicting ownership rules;
- a second concurrent mutation lock; and
- reuse of a local source-ref name with different provenance or content.

This supports the proposed rule that ordinary operational commands stop with
setup/rebind guidance when identity cannot be resolved exactly.

### Source refs and synchronization

The development clone fast-forwarded `main` from an explicitly supplied
destination path and verified exact equality. A named company branch was fetched
into `refs/shipyard/source/...` without adding a writable destination remote and
without publishing the local source ref to the development bare repository.

Git does not make a custom ref intrinsically read-only. "Read-only source ref"
is therefore a Shipyard invariant: record its remote/name/SHA provenance,
exclude the namespace from all push refspecs, validate it before use, and reject
commands that try to develop or publish from it directly.

### Ledger and evidence

An orphan `shipyard-ledger` branch remained outside product ancestry while a
separate worktree committed exact-SHA acceptance and independent-review
evidence. Changing the feature SHA immediately made the previous evidence
invalid; promotion could resume only after new evidence named the new SHA.

The final annotated tag retained the reviewed development commit after deletion
of the feature branch and was absent from the destination repository. The
ledger branch also remained development-only.

The test deliberately placed synthetic `.shipyard` and `.graphs` files on the
feature branch to challenge the sanitizer. That is an adversarial case, not the
normal design. The intended flow writes durable records to the parallel ledger
and rebuildable graphs to machine-local caches, keeping the product branch and
development PR metadata-free. Promotion still needs the sanitizer as a final
containment guard.

### Promotion, revision, and finalization

The initial destination payload was one sanitized product commit based on
current destination `main`. A newly reviewed development SHA produced one
additional product-delta commit. The first destination commit remained an
ancestor of the second, proving the append-only revision shape without a force
push.

A merge commit was created only in the destination clone. Because the sanitized
branch descended from the mirrored baseline, the resulting destination `main`
still fast-forwarded the clean development `main`. After that sync, the lab
deleted the development feature branch and destination delivery branch while
preserving the exact reviewed tag and ledger.

This validates the subtle history model: the development feature is never
merged, but clean development `main` can still fast-forward to the normal
destination merge because the destination payload was built from their shared
baseline.

## Prototype limitations that change the implementation plan

1. **Use Git-native payload construction.** The disposable script copies text
   files to make the state transition visible. Production code must construct
   and compare Git trees/indexes so binary files, executable bits, symlinks,
   renames, deletions, and unusual paths remain exact.
2. **Treat source-ref immutability as enforced policy.** A namespace alone does
   not prevent a user or process from updating a ref. Status must verify the
   recorded SHA and all Shipyard push operations must exclude it.
3. **Separate final ledger identity from its contents.** A commit cannot contain
   its own final SHA. The final record should name the previous checkpoint and
   reviewed/product/destination SHAs; the final ledger ref or a subsequent seal
   records and verifies the resulting ledger SHA.
4. **Keep locks short and add explicit stale-lock recovery.** This prototype
   proves atomic contention and release, not PID/host validation or recovery
   after a crashed process.
5. **Do not equate local refs with GitHub behavior.** Pull-request ownership,
   actors, branch protection, review dismissal, issue targeting, and
   close-without-merge behavior still require the approved private fixture
   prototype.
6. **Make cleanup resumable.** The one-command lab performs finalization
   serially. Production state must allow retry after any tag, ledger, sync,
   close, or delete step without repeating an unsafe mutation.

## Frontier consequences

Ticket 12 is resolved. It unblocks three independent next questions:

- ticket 13 can prove deterministic ledger/context resolution and concurrent
  checkpointing;
- ticket 14 can reuse the synthetic worktree fixture to test graph freshness;
  and
- ticket 16 can decide the exact private GitHub fixtures needed for the
  externally observable mechanics.

The local result does not authorize creating those external fixtures. Ticket 16
is a decision only; provisioning remains a later, explicitly invoked mutation.
