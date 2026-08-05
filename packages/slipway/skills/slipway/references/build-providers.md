# Build providers

Planning artifacts remain owned by Wayfinder, grilling, research/prototype, to-spec, and to-tickets regardless of build provider.

## Matt baseline

`matt` is the default and complete v1 provider. Work the `to-tickets` frontier. For each unblocked ticket, invoke `implement` with the canonical spec/ticket, exact branch, acceptance criteria, verification commands, forbidden actions, and standing instructions. `implement` uses TDD where appropriate, runs targeted and full verification, invokes code-review, and commits to the current agentic work branch.

Slipway records the result but does not restate the ticket. After all tickets integrate, run Slipway's separate exact-SHA delivery gate.

## Pstack enhancement

Use pstack only when `build_provider: pstack` is confirmed in project preferences or as a per-run override. Detection alone never selects it.

Hand pstack the canonical specification, ticket frontier and blocker edges, exact work branch, worker/reviewer briefs, cargo exclusions, and Slipway event contract. Use its ordinary feature/autonomous execution for work that fits a session. Use its orchestration playbook only for a genuine multi-day program; ceremony is not a benefit for a small frontier.

Pstack owns building fan-out. Slipway continues to own lane selection, artifact pointers, paired-repository policy, final exact-SHA gate, cargo transfer, delivery feedback, synchronization, and finalization.

## No fallback invention

CCPM is not a Slipway v1 provider. If the selected provider is missing, block and ask the user to install it or explicitly choose an available provider. Do not create a new executor inside Slipway.
