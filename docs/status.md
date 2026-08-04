# Status

`shipyard-status` resolves the local binding and its named global profile on
every invocation, verifies the bound profile identity, topology, and `status`
authorization, then prints the status projection. It performs no provider
mutation, filesystem write, or mutation-lock operation. An unbound, stale,
missing, malformed, changed, or unauthorized profile reports deterministic
setup/rebind guidance.
