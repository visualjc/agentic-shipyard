# Use baseline plus per-worktree graph state

Type: grilling  
Status: resolved

## Question

How should Shipyard reuse generated code knowledge while ensuring every
worktree and later session sees graph data matching its own code state?

## Answer

Durable human/agent reasoning records go to the ledger. Rebuildable graph and
index data remains machine-local by default. Profiles may opt curated snapshots
into the development-only ledger, with exact source SHA and Git LFS where size
requires it.

Shipyard may cache a baseline graph for an exact authoritative `main` SHA. A new
worktree receives a copy-on-write or otherwise safe seed into worktree-specific
storage, then incrementally processes the branch diff. Divergent worktrees never
share one mutable graph.

Each worktree records the indexed commit and working-tree fingerprint. Watchers
or hooks update during a session where supported. The next session compares the
fingerprint, runs an incremental refresh when required, and refuses to treat
stale output as authoritative. Failed refresh falls back to direct code
inspection rather than blocking development.

This architecture is settled; the reliability and exact adapter behavior of
CodeGraph, Graphify, and Understand Anything remain prototype questions.

## Comments

- Imported from the completed Shipyard grilling session on 2026-08-03.

