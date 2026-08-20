# Private project policy

This context belongs only to Slipway's private ledger and ignored local cache.
Slipway loads it explicitly; no tracked repository instruction file may be
created or changed merely to bootstrap this context.

Private context may augment a run, but it cannot weaken Slipway safety, cargo,
repository-identity, exact-SHA review, or external-write gates. Report an
ambiguous conflict instead of silently overriding core policy.
