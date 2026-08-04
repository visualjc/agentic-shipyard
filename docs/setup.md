# Setup

Run setup inside an existing Git repository with an explicit complete topology:

```sh
shipyard-setup --profile team-a --topology staged-pair \
  --development-name origin --development-url https://example.test/development.git \
  --destination-name destination --destination-url https://example.test/destination.git
```

The named profile must already exist at
`$SHIPYARD_HOME/profiles/<name>.json` (default `~/.shipyard`). Setup does not
create profiles. The file is the canonical version 1 profile document:

```json
{
  "schemaVersion": 1,
  "name": "team-a",
  "actor": { "login": "team-a-actor" },
  "topology": {
    "kind": "staged-pair",
    "development": {
      "owner": "owner", "name": "development",
      "remote": { "name": "origin", "url": "https://example.test/development.git" },
      "defaultBranch": "main"
    },
    "destination": {
      "owner": "team", "name": "product",
      "remote": { "name": "destination", "url": "https://example.test/destination.git" },
      "defaultBranch": "main"
    }
  },
  "allowedOperations": ["setup", "status", "help"]
}
```

The filename identifier, document `name`, topology kind, and named remote URLs
must match the setup request exactly. Missing, malformed, mismatched, or
setup-disallowing profiles block before the binding is written.

Shipyard validates the named remotes and Git common directory, then writes its
machine-local binding. It never provisions repositories or rewrites a remote.
An existing binding requires explicit `--rebind`; first fix any remote mismatch
outside Shipyard. Setup holds a mutation lock keyed by a hash of Git's common
directory for the binding transaction. A live lock blocks another writer;
stale recovery uses the lock's host/process ownership rules and fails closed
when ownership cannot be proven. See [metadata ownership](metadata-ownership.md).
