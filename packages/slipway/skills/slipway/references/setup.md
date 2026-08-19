# Setup contract

Slipway v1 supports only a paired topology.

## Read-only discovery

Observe absolute repository and worktree paths, Git common directories, current branches, dirty state, exact main SHAs, remotes, provider account when safely available, ledger state, local binding, ignore coverage, public instruction files, private overlay health, Matt configuration, installed skills, and cargo candidates. Redact credentials and secret-bearing URLs. A remote name or URL is evidence, not authority.

## Proposed binding

Show the agentic and delivery repositories and main branches, ledger branch/worktree, expected provider account, exact observed SHAs, portable preferences, machine-local paths, cargo rules, build provider, detected optional providers, public extension contract, private-overlay seed/hydration plan, and every write setup would perform.

Seed the cargo policy from [project.md](../assets/project.md), then let the user add or remove project-specific paths. Require explicit confirmation of repository roles, both base branches, expected provider account, complete cargo policy, and the public extension contract separately from private project policy. The public contract may be only the generic `AGENTS.md` extension line, “When `AGENTS.local.md` exists, read it after this file. It contains local-only instructions and must not be committed,” and a tracked `CLAUDE.md` containing `@AGENTS.md`; it must not name Slipway's repository topology, a private skill, or private policy.

## Initialization

Keep portable records on the ledger branch under `.slipway/`. Keep absolute machine paths in the ignored agentic-worktree file `.slipway-local/binding.md`. Prefer the repository-local Git exclude for `.slipway-local/` so agentic main does not need a product-history commit. Do not exclude `.slipway/` at repository scope because the ledger branch must track it. Do not place either record in product cargo.

The ledger branch must remain outside product ancestry and use a dedicated clean worktree. In the confirmed setup window, seed `.slipway/agent-overlay/` from [the canonical assets](../assets/agent-overlay/manifest.md) and validate its manifest. Its live ledger tree is authoritative. Materialize it only in Repo B, add only its required paths to that Repo-B clone's repository-local Git exclude, and record the hydrated tree ID separately under each worktree's `.slipway-local/`. Linked worktrees share the clone's exclude file but receive their own materialized overlay and version record. Never add private paths to a shared `.gitignore`, create a long-lived overlay branch, use hidden index flags, remove a worktree, or discard ledger changes during setup. Repair divergence only inside the confirmed project-policy/setup window after the user explicitly confirms the exact affected paths and the exact reconciliation or deliberate remove/recreate action. Never silently overwrite, replace, or discard private edits; after the confirmed repair, rehydrate and verify the worktree.

When Matt project conventions are absent and a work branch exists, hydrate its default overlay first, then invoke `setup-matt-pocock-skills` through the [run start contract](run-start.md), never on agentic main. Allow discovery, questions, and confirmed draft generation, but intercept its normal tracked `CLAUDE.md`/`AGENTS.md` write destination. In the explicit project-policy/setup window, persist proposed instruction additions to canonical `.slipway/agent-overlay/AGENTS.local.md` and supporting output under `docs/agents/**`; preserve `CLAUDE.local.md` as only `@AGENTS.local.md`. Commit the ledger policy update, rehydrate and byte-verify the current worktree, then mark Matt setup complete. Do not create a per-run metadata commit. If no work branch exists yet, record `Matt project setup: first-run-required`; run-start must consume that gate and complete this adapter before lane work.

Setup is complete only when binding and ledger records agree, the main relationship is known, the public/private contracts are separately confirmed, the overlay is seeded and locally verified in Repo B, core skills are discoverable, cargo rules are confirmed, and the next action is explicit. Setup stays read-only until its existing confirmation gate.
