---
name: shipyard-setup
description: Bind a complete, existing Shipyard repository topology without modifying remotes.
metadata:
  invocation: shipyard-setup --profile NAME --topology KIND ...
---

# Shipyard setup

Validate the repository and every declared remote before writing the local
binding. Rebinding is destructive to identity and requires explicit
`--rebind` after the operator verifies the topology.

Read [the setup reference](references/setup.md).
