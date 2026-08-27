# Slipway source-repository orchestration

This guidance applies only to work in this source repository. It is tracked
contributor tooling, not part of the distributable Slipway suite: do not copy,
install, generate, or require it in unrelated projects.

## Model roles

- Sol/high is the non-writing parent supervisor and plan reviewer. It
  reconciles evidence, owns routing, and produces the final orchestration
  trace; it never implements product/source changes or runs product tests or
  QA. When `$slipway` is active, Sol may update only coordinator-owned Slipway
  run summaries and ledger state, and may execute separately preflighted and
  authorized lifecycle or provider operations under Slipway safety. Sol is
  configured by root config, not a custom role.
- Use `context_gatherer` and `repo_knowledge` for bounded Luna/low/read-only
  discovery. On Codex 0.144.4, do not spawn unnamed or default delegated
  agents: always select one of these six named roles so its model and reasoning
  effort are explicit.
- Use `planner` for Terra/medium/read-only planning and `developer` as the one
  Terra/medium/workspace-write source writer for each approved owned scope. Do
  not run concurrent writers over the same source.
- After implementation, run `qa_tester` (Luna/high/workspace-write, but never
  edits source or runs rewriting formatters) and `reviewer` (Terra/high,
  read-only) concurrently against the same exact candidate.

## Flow

1. Have Luna discover relevant facts and seams, then have Terra produce a
   bounded plan with ownership and acceptance checks.
2. Sol reviews the plan before one Terra developer writes the approved scope.
3. Run QA and independent review concurrently after the writer reports an
   exact candidate SHA. Record commands, results, skipped checks, negative or
   edge coverage, failures, and residual risk.
4. Apply accepted fixes serially: one Terra writer changes the candidate, then
   rerun the affected QA and review for the new exact SHA. Do not overlap a
   fix loop with another writer or reuse stale evidence.
5. Sol emits a final orchestration trace: selected roles/models, discovery and
   plan evidence, writer ownership, candidate SHA, QA/review results, fix-loop
   history, remaining risk, and the next gate.

## Slipway boundaries

When `$slipway` is invoked, retain its lane selection, private-context,
ledger, cargo, repository-identity, exact-SHA, and external-write gates. This
orchestration guidance augments those rules; it cannot bypass them. Keep
private context and ledger state out of product cargo. Require exact candidate
SHAs for QA, review, and promotion. Coordinator-only ledger/lifecycle or
provider work retains Slipway's separate preflight and authorization
requirements.
