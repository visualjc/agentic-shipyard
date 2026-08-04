# Review procedure

Start from a trusted reviewer envelope pinned to the candidate product SHA.
The canonical review request must include `reviewedLedgerSha`,
`manifestDigest`, and `acceptanceDigest`; callers cannot omit or invent them.
Shipyard verifies those pins against the exact canonical ledger records, builds
the role-minimal path-redacted reviewer bundle, and binds the result's
`process.bundleDigest` to that bundle. Promotion independently reconstructs the
same bundle and requires acceptance-before-request-before-result ledger order.

Return only canonical JSON. If acceptance, intent, instructions, or product SHA
changes, create a new request and run a new independent review. If a finding is
accepted, a resolution alone is not sufficient: rebuild, renew acceptance, and
run a new independent review.
