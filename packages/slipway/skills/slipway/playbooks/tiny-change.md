# Tiny change

1. State the proposed `tiny-change` classification, settled behavior, inline acceptance criteria, expected seam, one-commit expectation, risk, and verification.
2. Ask the user for explicit permission. Without an affirmative answer, route to [small-development.md](small-development.md).
3. Apply the [run start contract](../references/run-start.md) and record the permission gate.
4. Invoke `implement` directly with the inline contract. Use TDD for behavior and keep agentic metadata separate from the one product commit.
5. Create or update the agentic PR through [agentic-pr.md](agentic-pr.md), then run the complete [exact-SHA delivery gate](../references/delivery-gate.md) against the integrated head.
6. Route the reviewed product commit through [promotion.md](promotion.md) and delivery follow-up.

Output the rationale, permission, acceptance evidence, exact reviewed SHA, cargo commit, and one next action.
