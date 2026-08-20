# Run status

## Verified observations

- Agentic branch/head: `<branch> @ <SHA>`
- Agentic PR/head/state: `<URL|none> @ <SHA|none> — <state>`
- Ledger head: `<SHA>`
- Private context health: `<healthy|missing|stale|divergent|unexpected|tracked|invalid> @ <cached tree ID|none>`
- Private context action: `<none|hydrate|repair>`
- Active context modules: `<module IDs|none>`
- Skipped context modules: `<module ID + reason|none>`
- Delivery PR/head: `<URL|none> @ <SHA|none>`
- Observed at: `<UTC timestamp>`

`Private context health` is a timestamped observation. The live canonical
ledger tree and this worktree's ignored `.slipway-local/context.version`
remain the authority for caching and module resolution.

`Private context action` records the exact next lifecycle operation. `none`
means the cache is healthy. `hydrate` means the read-only preflight proved a
missing or stale cache safe to refresh; it is not manual repair. `repair` means
unsafe context state must be reconciled in an explicit setup window.

## Complete

- `<completed outcome and evidence pointer>`

## Pending

- `<pending outcome>`

## Open gates

- `<gate ID or none>`

## Next action

`<exactly one action, required capability, and target>`
