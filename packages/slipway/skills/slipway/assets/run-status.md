# Run status

## Verified observations

- Agentic branch/head: `<branch> @ <SHA>`
- Agentic PR/head/state: `<URL|none> @ <SHA|none> — <state>`
- Ledger head: `<SHA>`
- Worktree overlay health: `<healthy|missing|stale|divergent|unexpected|tracked|invalid> @ <hydrated tree ID|none>`
- Worktree overlay action: `<none|hydrate|repair>`
- Delivery PR/head: `<URL|none> @ <SHA|none>`
- Observed at: `<UTC timestamp>`

`Worktree overlay health` is a timestamped observation. The live canonical
ledger tree and this worktree's ignored `.slipway-local/agent-overlay.version`
remain the authority for hydration.

`Worktree overlay action` records the exact next lifecycle operation. `none`
means the overlay is healthy. `hydrate` means the read-only preflight proved a
missing or stale materialization safe for normal lifecycle hydration; it is not
manual repair. `repair` means an unsafe divergent, unexpected, tracked, or
invalid state must be reconciled in an explicit project-policy/setup window.

## Complete

- `<completed outcome and evidence pointer>`

## Pending

- `<pending outcome>`

## Open gates

- `<gate ID or none>`

## Next action

`<exactly one action, required capability, and target>`
