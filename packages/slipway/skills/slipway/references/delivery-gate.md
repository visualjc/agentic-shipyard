# Exact-SHA delivery gate

Run after all ticket work integrates and after every accepted delivery-PR revision.

1. Verify the agentic repository, worktree, unique work branch, base SHA, exact candidate SHA, and clean/known dirty state.
2. Run the repository's targeted and full verification commands. Record exact commands, outcomes, environment limitations, and the candidate SHA.
3. Audit every acceptance criterion against observable evidence.
4. Invoke fresh independent `code-review` against the exact base/candidate range. Record standards and specification verdicts separately.
5. Identify the ordered product commits proposed as cargo. Inspect each commit and their combined patch against configured inclusions/exclusions.
6. Require agentic metadata and product changes to use separate commits. If any cargo commit is mixed, fix the commit boundary on the agentic branch, then rerun this entire gate at the new head.
7. Seal the gate only when QA, acceptance, review, and cargo inspection all name the same exact candidate SHA and no blocking finding remains.

Any new commit, amended commit, rebase, merge, or branch-head change invalidates the gate. Plain records do not prove the SHA still exists or remains current; verify it before promotion.
