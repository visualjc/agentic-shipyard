# Independent review

Shipyard evidence is authoritative only when the exact product SHA has a complete acceptance record and a current independent reviewer result. CCPM boxes, provider approval, and GitHub approval are display-only observations. A resolved accepted finding requires a renewed reviewer result at the resolution SHA.

`shipyard-review` provides focused guidance. Production callers construct review, promotion-evidence evaluation, and finding-resolution operations with `createTrustedCodexReviewOperation(...)`, `createTrustedAcceptanceGate(...)`, and `createTrustedFindingResolutionWriter(...)`. These factories bind an authoritative `ContextReader`, current product and ledger readers, and isolated Codex configuration once. Review and resolution derive the canonical lock path from the live bound repository common directory; callers cannot select a repository identity, ledger pin, manifest, history, reviewer/resolver identity, or ordering time per operation. Raw dispatch, process, evidence-persistence, and promotion-gate functions are not public.

The delivery-owned manifest is canonical JSON at
`deliveries/<id>/evidence/manifest.json`. Its exact SHA-256 digest is part of
the trusted context capability and envelope. Acceptance is always
`deliveries/<id>/evidence/acceptance.json`; review requests must cite that path
and `deliveries/<id>/intent.md`. Dispatch verifies manifest, acceptance, issue,
product SHA, and canonical bytes before starting a reviewer. The promotion gate
derives the manifest from the current complete ledger inventory and accepts no
caller-supplied manifest or history.

Every canonical `review-request.json` also carries three mandatory immutable
pins: `reviewedLedgerSha`, `manifestDigest`, and `acceptanceDigest`. The
dispatcher proves those values against the trusted reviewer envelope and the
exact canonical manifest/acceptance bytes at that ledger commit. It then uses
the shared canonical reviewer-bundle builder to produce a path-redacted bundle
containing the reviewed intent, review instructions, manifest, and acceptance
bytes plus a digest of the complete canonical request. The reviewer result's
`process.bundleDigest` is the SHA-256 of those exact bundle bytes.

The promotion gate independently reads those same records from
`reviewedLedgerSha`, requires `acceptance ordinal < request ordinal < result
ordinal`, checks that current intent/instructions and current canonical
acceptance still match the reviewed records, rebuilds the byte-identical bundle,
and compares its SHA-256 with `process.bundleDigest`. A same-product-SHA
acceptance renewal, changed intent or instructions, missing pinned record, or
forged digest makes the review stale or invalid and requires a new request and
review. Checked boxes and a caller-provided digest cannot satisfy this gate.

Production Codex review creates a private detached checkout of the requested
full product SHA and verifies its commit, tree, cleanliness, and source object
before and after the child process. Both the process working directory and
Codex `-C` point to this read-only snapshot, never the mutable source worktree.
The sealed reviewer bundle is capped at 2,500,000 UTF-8 bytes; durable evidence
records are capped at 1,000,000 bytes each, with bounded aggregate reads. A
timeout, oversized output, teardown uncertainty, source-object drift, or
snapshot drift fails closed.
