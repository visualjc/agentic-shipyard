# Small development

1. Apply the [run start contract](../references/run-start.md).
2. Invoke `grill-with-docs` to settle behavior, constraints, domain terms, and success evidence. Index its canonical artifacts.
3. Invoke `to-spec`, then `to-tickets`. Preserve their artifacts and blocker edges as canonical; store pointers only.
4. Select the configured build provider. Work the ticket frontier in delivery-safe product commits. Record immutable worker results.
5. After integration, create or update the agentic PR through [agentic-pr.md](agentic-pr.md), then run the complete [exact-SHA delivery gate](../references/delivery-gate.md). A changed head invalidates the gate.
6. Route through [promotion.md](promotion.md), then [delivery-follow-up.md](delivery-follow-up.md) until human merge or safe pause.

Output canonical artifacts, verified head, ordered cargo commits, delivery state, and one next action.
