# Keep synchronization narrow and explicit

Type: grilling  
Status: resolved

## Question

What may `shipyard-sync` change, and how should explicitly requested company
branches or tags become available to development agents?

## Answer

`shipyard-status` is the read-only daily audit. `shipyard-sync` is an explicit
clean mutation whose default operation fast-forwards development `main` to the
exact authoritative destination `main` and verifies equality. It requires clean
state and correct bindings/remotes. Ahead, divergent, dirty, ambiguous, or
conflicting state stops.

Sync never rebases or updates active feature branches, resolves conflicts,
force-pushes, changes remotes, touches issues/PRs, promotes, finalizes, or
modifies the ledger and Shipyard tags.

An explicit typed branch or tag argument may fetch that exact company ref. A
company branch remains a local read-only source ref; work begins on a separate
writable development branch. Imported source refs are not published to the
development GitHub repository and can be reproduced from their recorded owner,
name, and SHA. Ambiguous free-form refs and reserved Shipyard refs are rejected.

## Comments

- Imported from the completed Shipyard grilling session on 2026-08-03.

