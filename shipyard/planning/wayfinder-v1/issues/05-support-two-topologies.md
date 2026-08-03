# Support staged-pair and single-repository topologies

Type: grilling  
Status: resolved

## Question

Which repository topologies must Shipyard support, and what remains invariant
across them?

## Answer

`staged-pair` binds a development clone/repository and a destination
clone/repository. Development, repeated agent review, and the durable ledger
remain with the development actor. Promotion creates a branch physically hosted
by the destination owner and a normal same-repository destination PR; it never
creates a fork PR.

`single-repository` binds one repository. The development PR is also the final
PR. Promotion certifies its exact SHA, attaches the dossier, and marks a draft
ready; Shipyard does not create a second PR or merge automatically.

In both modes, development `main` exactly mirrors authoritative destination
`main`. Product work occurs on feature branches/worktrees. Before any
destination PR creation or update, the feature must incorporate current
destination `main`, then receive new acceptance and independent-review evidence
for its changed SHA.

One delivery unit maps one development PR, exact reviewed SHA lineage, review
dossier, and destination PR. Stacked deliveries are deferred.

## Comments

- Imported from the completed Shipyard grilling session on 2026-08-03.

