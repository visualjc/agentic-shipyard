---
name: shipyard-finalize
description: Request governed Shipyard finalization for an exact promoted candidate.
metadata:
  invocation: shipyard-finalize
---

# Shipyard finalize

Use finalization only for the exact promoted candidate returned by Shipyard.
It revalidates its own release conditions and returns a blocker or next safe
command; this skill does not merge or declare release readiness.

The packaged default has no finalization provider or credential. Without a
reviewed bound finalization composition it returns a configuration blocker and
performs no write.

Read [the finalization reference](references/finalization.md).
