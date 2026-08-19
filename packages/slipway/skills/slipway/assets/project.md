# Slipway project

- Project: `<name>`
- Agentic repository: `<owner>/<repo>`
- Agentic main: `<branch>`
- Delivery repository: `<owner>/<repo>`
- Delivery main: `<branch>`
- Ledger branch: `slipway-ledger`
- Agent overlay setup: `<complete|first-run-required>`
- Build provider: `matt`
- Matt project setup: `<complete|first-run-required>`
- Optional providers detected: `<none|pstack>`
- Last confirmed: `<UTC timestamp>`

## Cargo policy

### Include

- `<product path or rule>`

### Exclude

- `.ua/`
- `.slipway/`
- `.slipway-local/`
- `/AGENTS.local.md` at the worktree root
- `/CLAUDE.local.md` at the worktree root
- `/docs/agents/` at the worktree root
- `<PRD and planning paths>`
- `<research and prototype paths>`
- `<agent brief paths>`

## Human gates

- Merge is human-only.
- Force-push, deletion, authentication, remote changes, and deployment are human-only.
