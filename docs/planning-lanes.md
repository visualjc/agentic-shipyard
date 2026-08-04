# Planning lanes

Shipyard v1 has one live host: Codex CLI `0.144.4`. It classifies a request,
records that classification, verifies the selected lane's dependency receipt,
and returns the next safe public command. The classification is not authority
to change a repository, tracker, review, or release state.

| Request shape | Recorded route | Safe boundary |
| --- | --- | --- |
| Large or foggy work | Wayfinder, then a CCPM PRD and vertical CCPM tasks through Shipyard's typed planning service | Shipyard retains authority and evidence gates. |
| Settled small work | grill-with-docs, then to-spec; use to-tickets only for independent vertical slices | Do not inflate settled work into a CCPM PRD. |
| Bug | diagnosing-bugs | A disputed requirement or conflicting behavior escalates to grilling or Wayfinder. Diagnosis alone does not authorize implementation. |
| Review-only | Exact-SHA review intent | It cannot mutate implementation unless explicitly converted into a new delivery. |

The service selects the planning adapter and keeps dependency, ledger,
repository, actor, and provider authority out of skills and artifacts. A
missing, modified, duplicate, incompatible, or unverified dependency blocks
the chosen lane without automatic repair.

Claude Code, Cursor/Pstack, multi-account routing, and legacy `/pm:*` aliases
are deferred and unsupported in v1. Next safe action: use `shipyard` to record
the request, then follow the returned public command.
