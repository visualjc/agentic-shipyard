# Agentic Shipyard

Shipyard is an opinionated workflow for rich agentic development that delivers
only reviewed, destination-approved cargo.

> Shipyard keeps the scaffolding in the yard and launches only the reviewed
> cargo.

Status: private v1 foundation.

## First safe commands

Build first with `npm run build`, then invoke the local launchers:

```sh
node bin/shipyard-help setup
node bin/shipyard-setup --profile NAME --topology single-repository \
  --development-name origin --development-url URL
node bin/shipyard-status
```

Bindings are machine-local (`$SHIPYARD_HOME/bindings.json`, defaulting to
`~/.shipyard`) and keyed by Git's common directory, so a linked worktree shares
the main clone's identity. Setup validates existing remotes but never provisions
or rewrites them; replacing an existing binding requires `--rebind`.

Focused Codex skills are in `skills/shipyard*`; see [setup](docs/setup.md),
[status](docs/status.md), [help](docs/help.md), and
[metadata ownership](docs/metadata-ownership.md).
