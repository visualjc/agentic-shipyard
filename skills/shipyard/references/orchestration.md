# Orchestration reference

Give `shipyard` the work request and repository context. It records one lane
and returns one next safe command.

- Foggy work goes to Wayfinder before the planning service prepares a PRD and
  vertical tasks.
- Settled small work goes to grill-with-docs and to-spec.
- A bug begins with diagnosis. Conflicting or unclear requirements stop for
  grilling or Wayfinder; diagnosis does not authorize a code change.
- Review-only work stays an exact-SHA review intent until explicitly converted
  into a new delivery.

The local Codex-v1 composition atomically creates the isolated private ledger
on first bound use, records only bounded classification evidence, and returns
the focused skill command (`$wayfinder`, `$grill-with-docs`, or
`$diagnosing-bugs`). It does not claim that a Matt/CCPM plan is complete or
write planning artifacts; provider/ledger/artifact authority is never passed
through this skill. Do not replace this step with an ungoverned provider
command or copied workflow.

Next safe action: run the command returned by `shipyard`.
