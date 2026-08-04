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
node bin/shipyard "describe the work to plan"
node bin/shipyard-sync
```

Bindings are machine-local (`$SHIPYARD_HOME/bindings.json`, defaulting to
`~/.shipyard`) and keyed by Git's common directory, so a linked worktree shares
the main clone's identity. Setup validates existing remotes but never provisions
or rewrites them; replacing an existing binding requires `--rebind`. The named
version 1 profile must already exist in `$SHIPYARD_HOME/profiles/<name>.json`,
match the complete requested remote topology, and authorize setup. Setup takes
the common-directory lock first and then one Shipyard-home binding-store lock,
so concurrent setup in different repositories cannot lose a binding update.

`shipyard <request>` is live for an existing bound profile. Its first use
atomically bootstraps the isolated private ledger, then records a bounded
classification and returns the actual focused skill route (for example,
`$wayfinder` or `$grill-with-docs`). It does not invoke a planner, alter a
product ref, or create GitHub state. `shipyard-review`, `shipyard-promote`, and
`shipyard-finalize` remain fail-closed unless a separately reviewed,
credential-bearing release composition is supplied; they never infer a
provider or account from the environment.

The live classifier requires a reviewed machine-local
`$SHIPYARD_HOME/planning-host.json` containing absolute `executable`,
`runtimePath`, and isolated `codeHome` paths. Shipyard probes exactly Codex CLI
`0.144.4` and uses fixed `gpt-5.6-terra` / medium, read-only, ephemeral
classification; it never falls back to ambient Codex configuration.

Focused Codex skills are in `skills/shipyard*` and are discovered in this repo
through source-checkout `.agents/skills` symlinks (npm users run the packaged installer); see [skills](docs/skills.md), [setup](docs/setup.md),
[status](docs/status.md), [help](docs/help.md), and
[metadata ownership](docs/metadata-ownership.md), and
[synchronization](docs/synchronization.md).

## Experimental graph acceleration

Graphify and CodeGraph adapters are disabled by default and are never source or
delivery authority. They require explicit local-only approval, a reviewed tool
receipt, exact commit plus working-tree-fingerprint freshness, and otherwise
instruct the operator to inspect source directly. See the experimental
[Graphify](docs/graphify-experimental.md) and [CodeGraph](docs/codegraph-experimental.md)
guides.
