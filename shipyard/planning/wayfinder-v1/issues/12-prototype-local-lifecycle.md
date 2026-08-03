# Prototype the local Shipyard lifecycle

Type: prototype  
Status: resolved

## Question

Does a disposable local laboratory with two bare repositories and paired working
clones prove Shipyard's Git invariants without GitHub or production code?

The throwaway prototype should exercise profile binding, clean mirrored `main`,
a feature worktree, a parallel ledger branch/worktree, path classification,
local read-only source refs, exact-SHA evidence, an initial sanitized payload,
append-only review revisions, short mutation locks, human-merge simulation,
annotated tagging, finalization, and cleanup. It must deliberately test dirty,
divergent, ambiguous, stale-binding, unclassified-path, and conflicting-ref
failures.

The answer should capture which mechanics work, which assumptions fail, and what
must change in the v1 product definition. Prototype code is disposable and must
not be promoted as production implementation.

## Comments

- This is on the initial frontier.
- No real repositories, remotes, or GitHub resources may be touched.

## Answer

Yes. A one-command synthetic lab passed 29 lifecycle and guard assertions using
two temporary bare repositories, paired clones, a feature worktree, and a
parallel orphan ledger worktree. It proved clean mirrored `main`, common-dir
binding inheritance, exact-SHA evidence invalidation, sanitized initial and
append-only revision commits, destination-only merge, annotated development tag,
final fast-forward sync, durable ledger retention, and cleanup.

Dirty, divergent, ambiguous, stale-binding, unclassified-path, conflicting
path-policy, concurrent-lock, and conflicting-source-ref cases all stopped as
intended. The lab also clarified that source-ref immutability is a policy rather
than a Git primitive, production payloads need Git-native tree construction,
locks need explicit stale recovery, and finalization must be resumable.

The disposable implementation and full findings are under
[`../prototypes/local-lifecycle/`](../prototypes/local-lifecycle/).
