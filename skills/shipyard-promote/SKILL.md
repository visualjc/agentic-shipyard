---
name: shipyard-promote
description: Request a governed Shipyard promotion for an exact reviewed candidate.
metadata:
  invocation: shipyard-promote
---

# Shipyard promote

Use promotion only after Shipyard reports a current exact-SHA review and the
required evidence gates are ready. The command evaluates those gates itself;
this skill cannot bypass them or merge work.

The packaged default has no promotion provider or credential. Without a
reviewed bound promotion composition it returns a configuration blocker and
performs no write.

Read [the promotion reference](references/promotion.md).
