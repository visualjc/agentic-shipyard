# Setup contract

Slipway v1 supports only a paired topology.

## Read-only discovery

Observe absolute repository and worktree paths, Git common directories, current branches, dirty state, exact main SHAs, remotes, provider account when safely available, ledger state, local binding, ignore coverage, existing team-owned instruction files, private context health, Matt configuration, installed skills, and cargo candidates. Redact credentials and secret-bearing URLs. A remote name or URL is evidence, not authority.

## Proposed binding

Show the agentic and delivery repositories and main branches, ledger branch/worktree, expected provider account, exact observed SHAs, portable preferences, machine-local paths, cargo rules, build provider, detected optional providers, private-context seed/cache plan, and every write setup would perform.

Seed the cargo policy from [project.md](../assets/project.md), then let the user add or remove project-specific paths. Require explicit confirmation of repository roles, both base branches, expected provider account, complete cargo policy, and private context separately from team-owned repository instructions. Slipway must not create or change tracked `AGENTS.md`, `CLAUDE.md`, or another public instruction file merely to expose its context system. Existing team guidance remains delivery-owned and is changed only by an independently authorized product requirement.

## Initialization

Keep portable records on the ledger branch under `.slipway/`. Keep absolute machine paths in the ignored agentic-worktree file `.slipway-local/binding.md`. Prefer the repository-local Git exclude for `.slipway-local/` so agentic main does not need a product-history commit. Do not exclude `.slipway/` at repository scope because the ledger branch must track it. Do not place either record in product cargo.

The ledger branch must remain outside product ancestry and use a dedicated clean worktree. In the confirmed setup window, seed `.slipway/context/` from [the canonical assets](../assets/context/manifest.yaml) and validate the registry. Its live ledger tree is authoritative. Cache it only under Repo B's ignored `.slipway-local/context/`, add only `/.slipway-local/` to that clone's repository-local Git exclude, and record the tree ID separately per worktree. Never add private context to a shared `.gitignore`, create a long-lived context branch, use hidden index flags, remove a worktree, or discard ledger changes during setup. Repair divergence only inside the confirmed setup window after the user confirms the exact affected paths and reconciliation. Never silently overwrite private edits; refresh and verify after a confirmed repair.

## Existing-project migration

When a configured project has legacy `.slipway/agent-overlay/` policy but no
context registry, treat conversion as an explicit setup migration, not normal
cache hydration. Translate the private policy and supporting guidance into
context modules; do not carry host adapter files forward as context. Keep the
legacy ledger and materialized files unchanged until the new context tree
validates, its ignored cache byte-verifies, and every active run status records
the context tree, health, and active/skipped module selection for that run's
current operation. Only then, inside the confirmed setup window, remove the
exact legacy ledger, materialized, and version paths plus only the obsolete
legacy-specific repository-exclude entries. Retain `/.slipway-local/` and
preserve unrelated exclusions. Commit migration metadata separately and never
create or change a tracked public instruction file during conversion.

When Matt project conventions are absent and a work branch exists, validate its default private context first, then invoke `setup-matt-pocock-skills` through the [run start contract](run-start.md), never on agentic main. Allow discovery, questions, and confirmed draft generation, but intercept every tracked instruction destination. In the explicit setup window, persist the private draft and supporting metadata under `.slipway/context/modules/matt-skills/`, commit the ledger update, refresh and verify the ignored cache, then mark Matt setup complete. Do not create a per-run metadata commit. If no work branch exists, record `Matt project setup: first-run-required`; run-start consumes that gate before lane work.

Setup is complete only when binding and ledger records agree, the main relationship is known, private context is confirmed, the registry is seeded and locally verified in Repo B, required core skills are discoverable, cargo rules are confirmed, tracked public instructions were not changed merely for Slipway, and the next action is explicit. Setup stays read-only until its existing confirmation gate.
