# Ledger context envelopes

Shipyard keeps durable delivery records in the isolated ledger. A worker does
not receive broad ledger access; it receives one versioned envelope pinned to
an exact, lowercase 40- or 64-hex product SHA and ledger SHA. Its repository
must exactly match the delivery repository selected by the topology (the
development repository for a staged pair), and its ledger ref is always
`refs/heads/shipyard-ledger`.

## Role record sets

| Role | Exact paths for delivery `<id>` |
| --- | --- |
| Implementer | `deliveries/<id>/contract.md`, `deliveries/<id>/assigned-task.md` |
| Reviewer | `deliveries/<id>/intent.md`, `deliveries/<id>/acceptance.json`, `deliveries/<id>/review.json` |
| Status | none |

The allowlist is constructed by Shipyard. Callers cannot add paths, and an
envelope parser rejects serialized records that differ in either membership or
order.

## Host handoff and reading

The host-neutral adapter payload is exactly:

```ts
{ host, role, envelopePath, repoRoot }
```

Before any product or ledger call, the host supplies a trusted dispatch
capability outside the serialized envelope. It binds the profile fingerprint,
complete topology, selected repository, delivery ID, host, role, envelope path,
repository root, product branch/SHA and ledger ref/SHA. `ContextReader` compares
the parsed envelope to that capability first, so replacing both serialized
repository and topology cannot redirect a worker. It then resolves the active
binding/profile pair for the trusted repository root and requires the same
profile name, fingerprint, and topology before any product or ledger read.
Editing an envelope's role or delivery ID (including its adapter role), or
using a stale/wrong profile, is therefore rejected with zero ledger reads. It
then obtains the current product SHA for `repoRoot` and compares it to the
product pin. A mismatch stops the operation; no ledger record may be read. On
a match, context is loaded only through the pinned-read seam:

```ts
reader.read(envelope.ledgerSha, envelope.records)
```

This preserves auditability even after later ledger checkpoints. `GitLedgerStore`
implements the narrow `PinnedLedgerReader` interface by resolving the supplied
full ledger commit ID, proving it is reachable from the configured ledger ref,
and reading only that tree; it does not silently fall back to the ledger
branch’s current head or accept an unrelated product commit.

## Workspace initialization provenance

The first durable delivery record is a canonical version-1 JSON document. It
binds the delivery ID, Git common directory, canonical branch, exact starting
product SHA, and the caller's initial payload. The workspace service writes it
before creating the linked worktree and writes the registry last. A registry
entry without that record is rejected rather than repaired. The registry write
is also gated on a post-creation check that the canonical feature branch still
points at that recorded product SHA. If a concurrent creator supplied a
different branch during `worktree add`, Shipyard removes only the linked
worktree it just created and leaves the foreign branch untouched. When
recovering before registry creation, an existing branch is accepted only if
its head is the recorded starting SHA; a newly-created branch is explicitly
created at that SHA. `GitLedgerStore` always writes
`refs/heads/shipyard-ledger`; its constructor accepts no configurable ledger
ref. Its subprocesses use a canonical absolute Git executable and never
resolve a bare `git` from `PATH`.

### Ledger/product ancestry invariant

An existing canonical ledger ref is never trusted merely because it has the
right name. Before and after snapshots, pinned reads, and commit inspection,
and on both sides of transaction adoption, `GitLedgerStore` proves that the
ledger history has no common ancestor with any supported product ref. This
also rejects histories whose tips diverged from a shared commit, even when
neither tip is an ancestor of the other. Product refs are:

- every local branch under `refs/heads/` except the canonical ledger ref;
- every remote-tracking branch under `refs/remotes/`; and
- every lightweight or annotated tag under `refs/tags/` that peels to a
  commit. Tags of non-commit objects are not product-history authorities.

Shipyard has no supported remote-ledger or ledger-tag namespace. A copied
ledger commit under a remote-tracking branch or commit tag therefore fails
closed rather than being silently treated as another ledger retention ref.

Each successful check reads the product-ref inventory twice. If it changes
during the check, the operation stops with a transient unavailable error; if
the ledger head changes, it stops as stale. Transactions validate the
prospective commit before compare-and-swap adoption and validate the adopted
head again before returning. No poisoned ref is deleted, rewritten, or
automatically repaired: an operator must correct the explicit ref state, after
which a fresh operation revalidates everything. Ref changes made outside
Shipyard can still occur between Git commands, so the invariant is deliberately
checked on every operation instead of cached.

The compare-and-swap null object ID is derived from the repository's storage
object format. SHA-1 repositories use 40 zeroes and SHA-256 repositories use 64;
any unknown format is rejected rather than silently narrowed to SHA-1.

## Final delivery seal

A delivery's final ledger seal is a canonical version-1 JSON record at
`deliveries/<id>/final-seal.json`. It binds the stable delivery ID, exact
product SHA, and exact pre-seal ledger SHA. Its manifest is a strictly sorted
list of every sealed durable-record path and the SHA-256 of that record's exact
UTF-8 bytes. Missing, additional, reordered, duplicate, cross-delivery, unsafe,
or changed records invalidate verification. The seal path itself is forbidden
from the manifest.

`sealDelivery` first snapshots exactly the declared record paths plus the seal
path. Every declared record must exist and the seal must not. It then performs
one semantic compare-and-swap transaction against the exact snapshot head,
writing only the seal record. The returned commit SHA is the **external seal
commit SHA** and must be retained by the delivery workflow outside the seal.

This external SHA is intentional: a Git commit cannot contain its own final
object ID. Verification resolves that external SHA through `GitLedgerStore`,
proves it remains reachable from `refs/heads/shipyard-ledger`, inspects its
single parent and exact diff, and reads the seal plus manifested records from
that commit. The pure verifier then requires:

- the inspected commit to equal the external seal commit SHA;
- its parent to equal the seal's pre-seal ledger SHA;
- its only change to be addition of the final-seal record;
- the current product SHA to equal the sealed product SHA;
- exact manifest membership and byte hashes; and
- canonical seal serialization with no self-reference.

Any later product change makes the seal stale. Any ledger-record change,
missing/extra observed record, wrong commit or parent, altered seal bytes, or
attempt to seal the same delivery again fails closed.
