---
name: slipway-status
description: Reconstruct and summarize a Slipway project's planned, active, paused, blocked, delivery-waiting, and completed work from branch-named ledger shards. Use for `$slipway-status`, portfolio questions, setup diagnostics, or to locate the correct branch before resume. This skill is read-only unless the user separately asks to reconcile stale records.
---

# Slipway status

Preflight the canonical `slipway` skill in the current host. If it is absent, block and require installation of the complete Slipway suite; do not infer portfolio state.

Invoke `$slipway` with the forced read-only `status` operation and the user's scope. Do not classify it as development or require optional lane capabilities. Require the primary coordinator to report state counts, verified run facts, open gates, PR states, and one next action per run without rewriting portfolio state.
