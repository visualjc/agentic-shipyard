# Setup reference

`shipyard-setup` has one durable output, `$SHIPYARD_HOME/bindings.json`, plus an
ephemeral mutation lock; it never creates a profile/repository or changes Git
remotes. The named canonical version 1 profile
must already exist at `$SHIPYARD_HOME/profiles/<name>.json`, allow `setup`, and
match the requested topology/remotes. Required staged-pair inputs are profile,
development remote name/URL, and distinct destination remote name/URL. A
single-repository topology has only the development remote.

Setup holds the common-directory-keyed repository mutation lock across binding
read/write/rebind. Stale durable lock records are never removed automatically:
matching host and PID values are ambiguous across shared or containerized
checkouts. Follow the reported manual-recovery guidance before removing one.

Next safe action: run `shipyard-status` after a successful binding.
