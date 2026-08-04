---
name: shipyard-sync
description: Fast-forward a clean Shipyard baseline or import one exact destination source ref.
metadata:
  invocation: shipyard-sync [--source-ref REF] [--repo PATH] [--home PATH]
---

# Shipyard sync

Use only for explicit baseline synchronization or one named source import.
Read [the synchronization reference](references/sync.md). Never use this
operation for promotion, finalization, rebasing, repair, or force-pushing.
