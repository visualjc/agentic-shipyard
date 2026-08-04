# Status reference

Current v1 status reports the binding profile/topology, independent
`syncFreshness` and `graphFreshness` fields, and a safe next action. A graph
that is disabled by default does not replace sync blockers or their action.
Later slices contribute delivery, evidence, lock, provider, and graph fields
through the shared status projection; blockers accumulate without replacing
the action established by an earlier blocker.

Next safe action: run `shipyard-help` to select a supported operation.
