# Confirmed bug fix

1. Require a completed `diagnosing-bugs` result that records reproduction evidence and the first incorrect boundary, then reapply the [run start contract](../references/run-start.md) to the existing work branch and shard. If any requirement is missing, return to [bug-investigation.md](bug-investigation.md).
2. Invoke `implement` with a regression-test contract. Use TDD to make the reproduced behavior fail before the fix and pass afterward.
3. Keep the product fix/test commits separate from diagnosis and agentic metadata.
4. Create or update the agentic PR through [agentic-pr.md](agentic-pr.md), then run the complete [exact-SHA delivery gate](../references/delivery-gate.md).
5. Promote only the exact reviewed product commits and enter delivery follow-up.

Output reproduction, root cause, regression evidence, exact reviewed head, agentic PR, cargo commits, and one next action.
