# Setup reference

`shipyard-setup` writes only `$SHIPYARD_HOME/bindings.json`; it never creates a
repository or changes Git remotes. Required staged-pair inputs are profile,
development remote name/URL, and distinct destination remote name/URL. A
single-repository topology has only the development remote.

Next safe action: run `shipyard-status` after a successful binding.
