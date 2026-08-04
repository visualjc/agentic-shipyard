---
name: shipyard-review
description: Request an independent exact-SHA Shipyard review in Codex v1.
metadata:
  invocation: shipyard-review
---

# Shipyard review

Use review only for the exact candidate recorded by Shipyard. It returns a
review status or safe renewal action; it does not approve a changed candidate,
perform implementation, or promote work.

The packaged default has no ambient credential or provider observer. If a
reviewed bound review composition is not present, it returns a configuration
blocker rather than contacting a provider or claiming a review.

Read [the review reference](references/review.md).
