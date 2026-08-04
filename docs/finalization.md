# Finalization

`shipyard-finalize` is the final governed operation for an exact promoted
candidate. It independently rechecks release conditions, topology, current
review and acceptance evidence, and its lock before acting. It fails closed on
stale, incomplete, or externally gated state.

Finalization is not a merge command and it does not declare a release ready
without the required gate. Next safe action: invoke `shipyard-finalize` only
when Shipyard returns it.
