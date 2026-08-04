---
name: shipyard
description: Dispatch a Shipyard setup, status, sync, or focused help command safely.
metadata:
  invocation: shipyard <setup|status|sync|help>
---

# Shipyard

Start with `shipyard-status` when a repository may already be bound. Use
`shipyard-setup` only after the user supplies a complete existing topology.
Never infer a profile, rewrite a remote, provision a repository, or pass
`--rebind` without explicit intent.

Read [setup](../shipyard-setup/references/setup.md) or
[status](../shipyard-status/references/status.md) only for that operation.
