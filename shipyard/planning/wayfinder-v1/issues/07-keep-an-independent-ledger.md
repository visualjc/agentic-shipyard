# Keep an independent development ledger

Type: grilling  
Status: resolved

## Question

Where do durable agentic records live, how do they survive branch cleanup, and
how do Shipyard-aware tasks find them without polluting product branches?

## Answer

Each development repository may have a parallel `shipyard-ledger` branch. It is
not based between `main` and feature branches, is never a product-branch
ancestor, and is never copied to a destination repository. A separate local
ledger worktree checkpoints durable records throughout delivery under a stable
delivery ID.

Durable records include PRDs, specs, Wayfinder context, acceptance evidence,
review findings and resolutions, test evidence, context snapshots, promotion
manifests, and optional curated graph snapshots. Finalization completes the
ledger entry and creates an annotated development-only tag pointing to the
exact reviewed product SHA before closing the development PR and deleting its
feature branch.

Every Shipyard-aware task receives a pinned context envelope with the profile,
topology, repository, delivery ID, product branch/SHA, ledger ref/SHA, and
role-relevant record paths. The shared resolver infers a delivery from a bound
worktree when exactly one match exists, accepts an explicit delivery ID to
resolve ambiguity, and otherwise fails closed. Agents read ledger files through
Git without checking out the ledger in the product worktree.

A future read-only `shipyard-ledger-understand <tag>` may reconstruct the intent,
decisions, code, review, excluded artifacts, payload, and destination outcome.
It is not part of v1.

## Comments

- Imported from the completed Shipyard grilling session on 2026-08-03.

