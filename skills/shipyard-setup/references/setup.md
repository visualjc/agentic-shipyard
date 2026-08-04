# Setup reference

`shipyard-setup` consumes an existing named profile and repository topology.
It never invents a profile, changes a repository remote, selects an account,
or repairs dependencies. A missing, changed, or ambiguous binding is a blocker
with a non-mutating remediation.

Codex CLI is the only live v1 host. Next safe action: run `shipyard-status`
after setup reports a valid binding.
