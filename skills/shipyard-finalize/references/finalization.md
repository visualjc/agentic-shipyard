# Finalization reference

`shipyard-finalize` dispatches the trusted finalization operation only after
it revalidates the exact candidate, authoritative topology, acceptance and
review evidence, and the current release gate. It refuses stale or incomplete
state rather than inferring readiness.

Finalization does not merge work. Next safe action: follow the command returned
by `shipyard-finalize`.
