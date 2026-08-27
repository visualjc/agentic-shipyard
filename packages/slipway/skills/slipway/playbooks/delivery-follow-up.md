# Delivery PR follow-up

The delivery PR is the team's feedback authority and merge surface. The agentic work branch remains the implementation and testing source until merge.

1. Confirm mandatory baseline private context was attempted before provider discovery. Verify the scoped authorization and read the exact delivery PR account, repository, base, branch, head, checks, reviews, and feedback without mutation. If required context is unavailable, warn and mark this read-only assessment degraded; do not claim compliance with unavailable provider guidance. Do not look for team comments on the agentic PR.
2. Classify each item:
   - clear in-scope check failure, implementation mistake, agreed-seam test gap, formatting, or documented standard: address under valid scoped authorization;
   - behavior, acceptance, scope, architecture, spec/ADR conflict, unsafe request, ambiguity, or likely incorrect feedback: ask the user;
   - unrelated request: record and propose a separate uniquely named run.
3. Before implementation or any provider write, apply the complete [private context lifecycle](../references/store.md#private-context-lifecycle), record its health and selected modules, and load the coordinator-targeted entrypoints. A proven-safe missing or stale cache may refresh as normal preparation. Degraded read-only fallback does not authorize mutation; block until required context is healthy. Do not perform manual repair here. Implement every accepted change on the same agentic work branch. Never edit the delivery branch as the source of the fix. If delivery main moved, reconcile the agentic baseline only through the sync playbook and stop on divergence.
4. Update canonical planning artifacts when the accepted decision changes them. Implement/test, update the existing agentic PR through [agentic-pr.md](agentic-pr.md), then rerun the complete [exact-SHA delivery gate](../references/delivery-gate.md).
5. Cherry-pick only the new exact reviewed product commits onto the same delivery PR branch and verify patch equivalence. Re-enter monitoring.
6. Invalidate standing authorization when account, repository, base, branch, PR, cargo policy, identity, or scope changes.

Scoped authorization may permit ordinary pushes and narrow factual replies on this exact PR. Merge, force-push, deletion, authentication, remote changes, and deployment remain human-gated. If the team pushes code directly to the delivery branch, stop and ask how to reconcile the unexpected implementation source.
