# Promotion reference

`shipyard-promote` asks the trusted promotion operation to revalidate the
binding, topology, actor, evidence freshness, exact review, and operation lock
at its boundary. Status output and checked boxes are observations, not
authority. Any drift produces a deterministic blocker.

Promotion does not merge or finalize work. Next safe action: follow the
command returned by `shipyard-promote`.
