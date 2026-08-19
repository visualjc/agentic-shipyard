---
name: slipway-setup
description: Discover, initialize, validate, or repair Slipway configuration for an existing agentic repository paired with an existing clean delivery repository. Use before the first Slipway run, when `$slipway` detects missing or stale setup, or when repository roles, ledger worktree, Matt-skill configuration, build provider, accounts, base branches, or cargo exclusions change.
---

# Slipway setup

Preflight the canonical `slipway` skill in the current host. If it is absent, block and require installation of the complete Slipway suite; do not improvise setup from this entry point.

Invoke `$slipway` with the forced `setup` operation and the user's arguments. Do not classify it as a development lane. Require the primary coordinator to perform read-only discovery, separate confirmation of public extension and private policy, initialization gates, ledger-overlay hydration, and final verification.
