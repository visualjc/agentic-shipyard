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
entry without that record is rejected rather than repaired. When recovering
before registry creation, an existing branch is accepted only if its head is
the recorded starting SHA; a newly-created branch is explicitly created at
that SHA. `GitLedgerStore` always writes `refs/heads/shipyard-ledger`; its
constructor accepts no configurable ledger ref. Its subprocesses use a
canonical absolute Git executable and never resolve a bare `git` from `PATH`.
