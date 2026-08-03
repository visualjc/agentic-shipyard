# Make setup and identity fail closed

Type: grilling  
Status: resolved

## Question

How does Shipyard determine repository authority, identity, and safe concurrent
operation?

## Answer

Global profiles define topology, workflow preset, metadata policy, repository
allowlists, path policy, destination owners, and GitHub actors. Setup binds a
complete topology unit and validates it without cloning repositories, changing
remotes, or expanding an allowlist. A stale binding requires an explicit
`shipyard-setup --rebind` after showing the differences.

Every operational skill resolves and revalidates the binding before work. If it
cannot, it stops before any Git or GitHub mutation and tells the user to run
`shipyard-setup`. Only setup, status, and help may operate unbound. Linked Git
worktrees inherit their clone's binding through shared Git metadata; unrelated
clones do not.

GitHub actors are separate from repository owners. Profiles provide a default
actor with optional development and destination overrides. Shipyard verifies
and selects the configured authenticated identity per child command without
changing the machine-wide active `gh` account. It never stores credentials.

Mutations use short per-repository locks. Different repositories and worktrees
may proceed concurrently; setup, sync, promote, finalize, company PR updates,
and ledger commits serialize only their critical mutation. Stale lock recovery
is explicit and verified.

## Comments

- Imported from the completed Shipyard grilling session on 2026-08-03.

