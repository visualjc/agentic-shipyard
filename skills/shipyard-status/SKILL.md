---
name: shipyard-status
description: Inspect Shipyard binding status without locks, provider calls, or writes.
metadata:
  invocation: shipyard-status [--repo PATH] [--home PATH]
---

# Shipyard status

Status resolves the current binding from Git's common directory. It is
read-only and does not acquire a mutation lock. If binding resolution fails,
follow its deterministic setup/rebind guidance.

Read [the status reference](references/status.md).
