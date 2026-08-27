---
name: slipway-status
description: Reconstruct and summarize a Slipway project's planned, active, paused, blocked, delivery-waiting, and completed work from branch-named ledger shards. Use for `$slipway-status`, portfolio questions, setup diagnostics, or to locate the correct branch before resume. This skill is always read-only; reconciliation, hydration, and repair belong to the lifecycle-owning operation.
---

# Slipway status

Preflight the canonical `slipway` skill in the current host. If it is absent, block and require installation of the complete Slipway suite; do not infer portfolio state.

Invoke `$slipway` with the forced read-only `status` operation and the user's scope. Do not classify it as development or require optional lane capabilities. Apply the mandatory read-only [private context lifecycle](../slipway/references/store.md#private-context-lifecycle): read the binding, validate available context, read the manifest, and load available coordinator baseline modules declared `operations: [all]` before scanning state. If baseline context is unavailable, warn and mark status degraded rather than blocking the scan. Then report state counts, verified run facts, context observations, open gates, PR states, and one next action per run. Status must not invoke `$slipway-setup`, hydrate or repair context, activate operation-specific lane modules, execute lane work, rewrite portfolio state, or require delivery capabilities.
