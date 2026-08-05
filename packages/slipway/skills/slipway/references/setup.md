# Setup contract

Slipway v1 supports only a paired topology.

## Read-only discovery

Observe absolute repository and worktree paths, Git common directories, current branches, dirty state, exact main SHAs, remotes, provider account when safely available, ledger state, local binding, ignore coverage, Matt configuration, installed skills, and cargo candidates. Redact credentials and secret-bearing URLs. A remote name or URL is evidence, not authority.

## Proposed binding

Show the agentic and delivery repositories and main branches, ledger branch/worktree, expected provider account, exact observed SHAs, portable preferences, machine-local paths, cargo rules, build provider, detected optional providers, and every write setup would perform.

Seed the cargo policy from [project.md](../assets/project.md), then let the user add or remove project-specific paths. Require explicit confirmation of repository roles, both base branches, expected provider account, and the complete cargo policy.

## Initialization

Keep portable records on the ledger branch under `.slipway/`. Keep absolute machine paths in the ignored agentic-worktree file `.slipway-local/binding.md`. Prefer the repository-local Git exclude for `.slipway-local/` so agentic main does not need a product-history commit. Do not exclude `.slipway/` at repository scope because the ledger branch must track it. Do not place either record in product cargo.

The ledger branch must remain outside product ancestry and use a dedicated clean worktree. Report branch/worktree creation before performing it and verify afterward. Never repair divergence, remove a worktree, or discard ledger changes during setup.

When Matt project conventions are absent and a work branch exists, invoke `setup-matt-pocock-skills` on that branch through the [run start contract](run-start.md), never on agentic main. Commit its tracker, labels, document layout, and related output as agentic metadata in commits separate from product cargo. If no work branch exists yet, record `Matt project setup: first-run-required`; run-start must consume that gate, complete the delegation, and mark it `complete` before lane work.

Setup is complete only when binding and ledger records agree, the main relationship is known, core skills are discoverable, cargo rules are confirmed, and the next action is explicit.
