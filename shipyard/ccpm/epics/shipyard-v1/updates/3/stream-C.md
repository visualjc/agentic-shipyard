---
issue: 3
stream: C — Role-limited envelopes, freshness, status contribution, and docs
status: implemented
---

Own only `src/context/**`, `src/delivery/status.ts`, `docs/ledger-context.md`,
`test/context/**`, and `test/delivery/status.test.ts`.  Consume A/B ports and
compose the existing status projection without editing it.  Do not create
provider fields, credentials, or GitHub/PR behavior.

## Delivery

- Added canonical, deeply immutable context envelopes for implementer,
  reviewer, and status. Their exact record sets are respectively contract/task,
  intent/acceptance/review, and empty.
- The host handoff is constrained to `{host, role, envelopePath, repoRoot}`.
  `ContextReader` verifies the current product SHA before it invokes its ledger
  dependency; the focused test proves a stale pin causes zero reads.
- Stream B currently provides only `LedgerStore.snapshot(paths)` at its current
  head, which cannot meet an exact ledger-SHA read. C therefore exposes the
  narrow local `PinnedLedgerReader.read(ledgerSha, paths)` integration seam.
  B (or its Git adapter) must adapt that seam with `git show <sha>:<path>`
  semantics; C did not modify Stream B ownership.
- Added the pure `deliveryStatusContributor` for product/ledger pins, composed
  through the existing shared projection without editing it.
- Added `docs/ledger-context.md` and focused envelope, reader, and delivery
  status tests.
