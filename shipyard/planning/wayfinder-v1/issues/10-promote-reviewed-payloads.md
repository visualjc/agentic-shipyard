# Promote reviewed payloads without fork PRs

Type: grilling  
Status: resolved

## Question

How do exact reviewed development changes reach the destination, receive later
company-requested revisions, and finalize without leaking metadata or rewriting
review history?

## Answer

Staged-pair promotion calculates the reviewed tree difference, excludes all
non-product paths under the fail-closed path policy, applies the product payload
to a fresh destination-owned branch, and opens a normal PR inside the
destination repository. The initial payload is one sanitized commit. The
development PR is never used as a fork PR and is not merged.

Company-requested changes are made only on the development branch, refreshed
against current destination `main`, and accepted/reviewed at a new exact SHA.
Shipyard appends one sanitized product-delta commit per revision to the existing
destination PR branch. It never force-pushes an active company PR. The manifest
maps every approved development SHA to its destination commit and verifies the
final product tree.

The destination's normal human process merges the destination PR. Finalization
then completes and pushes the ledger entry, creates and verifies the annotated
development-only reviewed tag, synchronizes the merged destination `main`
exactly to development `main`, closes rather than merges the development PR,
and deletes the development feature branch.

For a single-repository topology, promotion verifies that the existing PR head
is the approved SHA, contains no prohibited metadata, attaches the review
dossier, and marks it ready. Human merge and the same archive/tag/sync/cleanup
finalization follow.

## Comments

- Imported from the completed Shipyard grilling session on 2026-08-03.

