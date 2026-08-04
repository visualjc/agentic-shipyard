---
issue: 3
stream: A — Delivery identity, local registry, and resolver
status: implemented
---

Own only `src/delivery/{types,errors,registry,resolver}.ts` and
`test/delivery/{registry,resolver}.test.ts`.  Publish immutable resolver and
registry ports to B/C; do not implement physical Git workspace or ledger
mutation, context envelopes, provider behavior, public exports, or CLI wiring.

## Delivered

- Added versioned `DeliveryWorkspace` and `DeliveryRegistryDocument` contracts,
  plus the narrow `DeliveryRegistry` port and atomic-filesystem
  `JsonDeliveryRegistry` adapter. Registry input is deep-validated on both
  reads and writes; duplicate delivery IDs and duplicate linked-worktree paths
  are rejected.
- Added `DeliveryResolver`, which first resolves the existing canonical binding
  and then reads the registry afresh for every call. Implicit resolution is
  exact linked-worktree-path selection; explicit delivery IDs are allowed from
  any bound worktree with the same canonical common directory.
- Added structured fail-closed delivery errors for missing/invalid registries,
  duplicates, no matching delivery, ambiguity, and identity/worktree mismatch.
  Resolver results are deeply frozen independent snapshots, never cached
  mutable registry authority.

## Published API inventory

- `DeliveryWorkspace`, `DeliveryRegistryDocument`, `DeliveryRegistry`,
  `DeliveryResolutionRequest`, `ResolvedDelivery`
- `DeliveryError`, `DeliveryFailureCode`
- `JsonDeliveryRegistry`, `newDeliveryRegistryDocument`,
  `validateDeliveryRegistryDocument`
- `DeliveryResolver.resolve(request)`

## Verification

- Stream-local strict TypeScript dependency-closure check: pass.
- Stream-local compiled Node tests: 7 passing. They cover version validation,
  persisted registry validation, duplicate rejection, linked-worktree/common
  directory identity, explicit selection, missing/ambiguous/invalid/mismatch
  failures, and resolver recomputation.
- Repository-wide `npm run build` and `npm test`: pass (74 tests).
