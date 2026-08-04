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
  "allowedOperations": ["setup", "status", "help"],
  "pathPolicy": {
    "schemaVersion": 1,
    "rules": [{ "owner": "product", "pattern": "src/**" }]
  }
}
```

The filename identifier, document `name`, topology kind, and named remote URLs
must match the setup request exactly. Missing, malformed, mismatched, or
setup-disallowing profiles block before the binding is written.

`pathPolicy` is profile-owned authority. Operational path classification must
consume this validated profile policy, never an unrelated local policy.

Shipyard validates the named remotes and Git common directory, then writes its
machine-local binding. It never provisions repositories or rewrites a remote.
An existing binding requires explicit `--rebind`; first fix any remote mismatch
outside Shipyard. Setup takes the common-directory mutation lock and then the
single Shipyard-home binding-store mutation lock for every read-modify-write.
A live lock blocks another writer. Stale primary locks and populated lifecycle
guards always require manual recovery: matching hostname and PID observations
are not global proof in shared or containerized checkouts. Lifecycle creation,
release, and recovery use a
short sibling transition record so finalization cannot remove a replacement.
That transition record is never auto-recovered: a crashed transition requires
manual inspection before removal. Before removing any durable lock record,
verify its owner is inactive in every checkout or container sharing the path.
See
[metadata ownership](metadata-ownership.md).
