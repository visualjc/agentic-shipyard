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

Before any ledger call, the worker obtains the current product SHA for
`repoRoot` and compares it to the envelope pin. A mismatch stops the operation;
no ledger record may be read. On a match, context is loaded only through the
pinned-read seam:

```ts
reader.read(envelope.ledgerSha, envelope.records)
```

This preserves auditability even after later ledger checkpoints. `GitLedgerStore`
implements the narrow `PinnedLedgerReader` interface by resolving the supplied
full ledger commit ID, proving it is reachable from the configured ledger ref,
and reading only that tree; it does not silently fall back to the ledger
branch’s current head or accept an unrelated product commit.
