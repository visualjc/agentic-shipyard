---
name: shipyard
description: Start or resume a governed Shipyard planning lane in Codex v1.
metadata:
  invocation: shipyard <request>
---

# Shipyard

Use this skill to describe work that needs a governed delivery lane. From an
existing bound v1 profile, `shipyard <request>` atomically bootstraps its
isolated private ledger if needed, records a bounded classification, and
returns the actual focused skill route. This narrow operation does not invoke
a planner, alter product Git state, or create tracker state.

Codex CLI is the only supported live host in v1. Claude Code and Cursor/Pstack
are deferred and unsupported.

Read [the orchestration reference](references/orchestration.md).
