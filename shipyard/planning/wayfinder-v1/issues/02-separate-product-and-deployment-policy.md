# Separate the generic product from deployment policy

Type: grilling  
Status: resolved

## Question

How should reusable Shipyard code and documentation be separated from Jim's
real repository profiles and potentially proprietary context?

## Answer

`computer-management/shipyard/` holds the generic product and is designed to
become its own open-source Git repository. It contains reusable skills,
references, schemas, deterministic tools, tests, and fictional example profiles.

`computer-management/shipyard-config/` is a sibling deployment package holding
real `justgames` and `visualjc` profiles, repository allowlists, path policies,
and private context overlays. Machine-specific bindings, worktree state, caches,
locks, and credentials live outside both packages in user-local state.

No generic implementation may hardcode `justgamesjim`, `SentientDogs`, or the
paired-clone layout. Those are profile policy.

## Comments

- Imported from the completed Shipyard grilling session on 2026-08-03.

