# Sync reference

`shipyard-sync` dispatches only the bounded operation selected from the live
binding. It independently validates the current topology, actor, path policy,
and operation lock before any governed external action. A stale or ambiguous
fact is a refusal, not a reason to improvise a repair.

No raw repository or provider workflow belongs in this skill. Next safe action:
follow the command returned by `shipyard-sync`.
