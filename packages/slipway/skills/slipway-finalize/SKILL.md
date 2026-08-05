---
name: slipway-finalize
description: Finalize one branch-named Slipway run after human delivery merge, authoritative main synchronization, and agentic-PR closure without merge. Use for `$slipway-finalize` with a branch argument, completion reconciliation, archive compaction, or determining why a run cannot yet close.
---

# Slipway finalize

Preflight the canonical `slipway` skill in the current host. If it is absent, block and require installation of the complete Slipway suite; do not compact or remove records from this entry point alone.

Require the complete work-branch name and invoke `$slipway` with the forced `finalization` operation and that exact branch. Require the primary coordinator to verify every Git/provider precondition, including that synchronization already closed the agentic PR without merge; keep incomplete runs active, archive the evidence, and remove only exact shard-owned files in one scoped ledger commit.
