---
name: slipway-sync
description: Audit and synchronize authoritative delivery main into clean agentic main with fail-closed ancestry and worktree checks. Use for `$slipway-sync`, post-merge synchronization, stale agentic-main diagnosis, setup repair, or before finalization. Never use this skill to merge an agentic work branch.
---

# Slipway sync

Preflight the canonical `slipway` skill in the current host. If it is absent, block and require installation of the complete Slipway suite; do not synchronize from this entry point alone.

Invoke `$slipway` with the forced `synchronization` operation and the user's exact refs. Require the primary coordinator to default to read-only audit, prove fast-forward ancestry, stop on divergence, rehydrate and verify the private overlay only after a clean fast-forward, separately gate remote writes, reconcile other active work branches, and never merge an agentic work branch or PR.
