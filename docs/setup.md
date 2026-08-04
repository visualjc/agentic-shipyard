# Setup

Run setup inside an existing Git repository with an explicit complete topology:

```sh
shipyard-setup --profile team-a --topology staged-pair \
  --development-name origin --development-url https://example.test/development.git \
  --destination-name destination --destination-url https://example.test/destination.git
```

Shipyard validates the named remotes and Git common directory, then writes its
machine-local binding. It never provisions repositories or rewrites a remote.
An existing binding requires explicit `--rebind`; first fix any remote mismatch
outside Shipyard. See [metadata ownership](metadata-ownership.md).
