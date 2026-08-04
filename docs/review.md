# Independent review

Shipyard evidence is authoritative only when the exact product SHA has a complete acceptance record and a current independent reviewer result. CCPM boxes, provider approval, and GitHub approval are display-only observations. A resolved accepted finding requires a renewed reviewer result at the resolution SHA.

`shipyard-review` provides focused guidance. Production callers construct the operation with the public `createTrustedCodexReviewOperation(...)` factory. The factory requires an authoritative `ContextReader`, product and ledger readers, a durable `MutationLockService` and lock path, and isolated Codex configuration; it does not expose the raw dispatcher or process adapter.
