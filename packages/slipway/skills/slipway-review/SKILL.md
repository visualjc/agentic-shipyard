---
name: slipway-review
description: Run or record Slipway's independent final delivery review for one exact agentic candidate SHA. Use for `$slipway-review`, final QA/review, review renewal after fixes, cargo inspection, or a review-only request. The skill reviews without editing product code or mutating providers.
---

# Slipway review

Preflight the canonical `slipway` skill in the current host. If it is absent, block and require installation of the complete Slipway suite; do not improvise a partial review workflow.

Require exact base and candidate SHAs plus a canonical specification pointer or an explicit statement that no specification exists. Invoke `$slipway` with the forced `review` operation and those exact arguments. Require the primary coordinator to use a fresh context, report standards and specification findings separately, record one immutable review event, and invalidate the verdict after any head change.

For final delivery review, review renewal after fixes, or cargo inspection, also require canonical acceptance pointers and run the complete exact-SHA delivery gate, including cargo inspection. For an ordinary review-only request, stop after the review-only playbook; do not impose promotion or cargo requirements.
