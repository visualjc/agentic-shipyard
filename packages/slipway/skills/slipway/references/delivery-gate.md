# Exact-SHA delivery gate

Run after all ticket work integrates and after every accepted delivery-PR revision.

1. Verify the agentic repository, worktree, unique work branch, base SHA, exact candidate SHA, and clean/known dirty state.
2. Run the repository's targeted and full verification commands. Record exact commands, outcomes, environment limitations, and the candidate SHA.
3. Audit every acceptance criterion against observable evidence.
4. Invoke fresh independent `code-review` against the exact base/candidate range. Record standards and specification verdicts separately.
5. Resolve the bound ledger and read its canonical `.slipway/context/` tree before cargo inspection. Refuse to seal this gate if the binding, manifest, required context health, or selected module record is unavailable or unhealthy. Inspect every commit patch and resulting tree in `review-base..candidate-SHA`, plus the final diff and tracked state. From that canonical ledger context tree, inventory the module paths, identifiers, headings, paragraphs, and list items, then compare that inventory with changed tracked instructions and supporting paths across the full candidate range. Reject ledger context, `.slipway-local/**`, context-derived private policy, and any tracked instruction change whose only purpose is to bootstrap Slipway. A change to team-owned `AGENTS.md`, `CLAUDE.md`, or another public instruction requires an independent product acceptance source indexed in `artifacts.md`; Slipway context is never that source. Record each compared source and disposition in the immutable review event and fail closed on ambiguity. Do not confuse reviewed context templates under an included product path with live private context.
6. Require agentic metadata and product changes to use separate commits. If any cargo commit is mixed or any live private context/cache path is tracked, fix the boundary on the agentic branch, then rerun this entire gate at the new head.
7. Seal the gate only when QA, acceptance, review, and cargo inspection all name the same exact candidate SHA and no blocking finding remains.

Any new commit, amended commit, rebase, merge, or branch-head change invalidates the gate. Plain records do not prove the SHA still exists or remains current; verify it before promotion.
