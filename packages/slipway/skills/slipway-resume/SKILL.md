---
name: slipway-resume
description: Resume a paused or interrupted Slipway run from its complete agentic work-branch name and durable ledger shard. Use for `$slipway-resume` with a branch argument, “resume this Slipway run,” session pickup, context recovery, or continuing delivery-PR follow-up without relying on the previous chat.
---

# Slipway resume

Preflight the canonical `slipway` skill in the current host. If it is absent, block and require installation of the complete Slipway suite; do not reconstruct a run ad hoc.

Require the complete work-branch name, or invoke `$slipway-status` so the user can select it. Then invoke `$slipway` with the forced `resume` operation and that exact branch. Require the primary coordinator to verify durable claims and the canonical private-overlay tree/bytes before lane work, reject reuse or revival, report the done/pending split and gates, and continue with exactly one next action.
