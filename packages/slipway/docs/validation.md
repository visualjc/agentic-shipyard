# Slipway validation

## Original prototype evidence

The behavioral scenarios below were validated locally on 2026-08-04 in worktree `/Users/jimcarter/projects/computer-management/shipyard-worktrees/slipway` on branch `experiment/slipway`. They are historical prototype evidence; they do not claim to validate the later source-only branch reconstruction or a global host installation.

No GitHub/Linear write, network provider mutation, remote edit, authentication change, push, PR mutation, merge, force-push, deployment, or branch deletion occurred during those scenarios.

## Source-only rewrite evidence

The source-only reconstruction was validated on 2026-08-05 in worktree `/Users/jimcarter/projects/personal_projects/shipyard/worktrees/agentic/rewrite-slipway-source-only` against shared base `7bfe2565d9ef2bc1af6f5caacc298aa32e5efbaa`. Reconstructed candidate `d525339d9875a2a5ef6ecd2be0b7fdff5337aa44` passed the official validator for all eight skills, YAML parsing for all eight `agents/openai.yaml` files, relative Markdown-link resolution, `git diff --check`, package-content inspection, and per-commit forbidden-path inspection. The candidate and its only feature commit contained no root `.agents/`, `.cursor/`, `.claude/`, or `build/` paths.

Independent review then required clearer evidence attribution and a staged installation rollback procedure. Those documentation corrections necessarily create a later candidate. Its exact SHA and renewed QA/review evidence live in the branch-named external Slipway ledger and delivery PR because a Git commit cannot embed its own final SHA truthfully.

Fresh Cursor IDE, Cursor CLI, Codex, and Claude Code discovery remains a post-merge installation check. It cannot be claimed before authoritative delivery `main` contains the suite and the user authorizes copying it to the global skill roots.

## Static validation

- The official skill-authoring `quick_validate.py` passed all eight skills: `slipway`, setup, status, resume, review, sync, promote, and finalize. The validator's missing PyYAML dependency was installed only into a temporary directory and is not a project dependency.
- YAML inspection confirmed that every `agents/openai.yaml` has the intended display name, a 25–64 character short description, and a default prompt containing its literal `$slipway-*` invocation.
- A local link check resolved every relative Markdown link.
- The package contains only Markdown and YAML files. It contains no script, executable, TypeScript, service, schema runtime, state machine, provider adapter, or Git abstraction.
- Canonical skills live only under `packages/slipway/skills/`; the clean cargo branch tracks no root `.agents/`, `.cursor/`, `.claude/`, generated `build/`, or host plugin artifacts. This source-only rule was renewed against the reconstruction described above, not inferred from the original prototype run.
- `git diff --check` passed.
- In the original `experiment/slipway` worktree, the pre-existing TypeScript source, tests, package manifests, active Shipyard skills, and root README matched accepted SHA `d03351135a44e9f2017ae1dedb646d488d33824c` exactly. The clean `feature/slipway` cargo branch is intentionally based on the repositories' shared bootstrap `main` and adds only the standalone Slipway package plus repository-level ignore policy; it does not claim to contain the unmerged Shipyard policy-engine branch.
- Run-fixture validation found eight unique, path-disjoint active work-branch identities, one non-reused archived identity, nine globally unique immutable active-snapshot events, no shared global `status.md`, a matching worker/reviewer exact SHA, and identical delivery/agentic main SHAs after finalization. A retained-tag snapshot records the authorized PR-42 transfer, and a separate finalized-ledger snapshot preserves the same branch/PR identity through merge while omitting its former active shard. Every fixture manifest, status, gate, artifact, event, and archive record follows the current reusable asset contract.

## Fresh-context behavioral tests

Independent read-only agents received the Slipway skill path and realistic prompts without this design discussion or expected outputs.

### 1. Large feature

Input: a cross-product capability spanning multiple sessions with unresolved product behavior, domain boundaries, migration, and rollout.

Result: `large-development`. The agent required setup first, then selected Wayfinder → focused research/prototype when needed → to-spec → to-tickets → Matt implement/TDD frontier → exact-SHA delivery gate → promotion/follow-up. Prototype adoption remained human-gated.

### 2. Small change

Input: a settled API response-field rename that may affect several call sites.

Result: `small-development`, not tiny. The route was grill-with-docs → to-spec → to-tickets → implement/TDD → QA/acceptance → fresh exact-SHA review → promotion/follow-up.

### 3. Tiny permission

Input: one validation-message typo, one file/test seam, one expected product commit.

Result: `tiny-change` candidate with an explicit rationale. The agent correctly stated that “Use Slipway” is not permission and would fall back to small development without an affirmative user answer.

### 4. Ambiguous bug

Input: failing totals behavior where docs and requested behavior disagree.

Result: `bug-investigation`. The agent required reproduction and the first incorrect boundary, classified the conflict as a product decision rather than a true bug, stopped implementation, and routed to grill-with-docs or Wayfinder by scope.

### 5. Confirmed bug gate

Input: a regression described as already reproduced with its first incorrect boundary known.

Result: the claim still routes through `bug-investigation` until `diagnosing-bugs` records that evidence. Only that completed diagnosis can enter `bug-fix`, which requires a regression-test contract, Matt `implement`/TDD, the private agentic PR, the linked exact-SHA delivery gate, and reviewed product-only cargo.

### 6. Capability installation gate

Input: ready spec/tickets with an explicit pstack build override but no Poteto Mode in the active host.

Result: build blocked at `CAP-PSTACK`. The agent did not silently switch to Matt, invent an executor, or install unverified tooling. It required installation from a user-approved source or an explicit provider change, followed by rediscovery and repeated preflight.

### 7. Research and prototype

Input: a provider fact followed by a runnable state-model comparison.

Result: read-only primary-source research could proceed autonomously and remained a canonical cited artifact. Prototype output stayed throwaway and delivery-excluded; the agent stopped for human feedback before adopting a state model.

### 8. Worker result and independent review

Fixture: run `feature/reviewed-worker` records worker completion and a separate reviewer event for exact SHA `1111111111111111111111111111111111111111`.

Result: the manifest, private agentic-PR target, worker event, review event, and promotion preflight agree on the candidate. A changed head would invalidate the review.

### 9. Pause and resume

Fixture: `feature/paused-run` records QA at exact SHA `2222222222222222222222222222222222222222` and no review.

Result: a fresh session can identify the completed/pending split and exactly one next action: `$slipway-review` at that SHA. No chat transcript is needed.

### 10. Promotion without mutation

Fixture: the reviewed run proposes cargo commit `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` onto an illustrative delivery head.

Result: the record names the reviewed head, exact cargo, destination branch/head, patch-equivalence and exclusion checks, and authorization gate. It explicitly records that no branch, cherry-pick, network request, push, or PR mutation occurred.

### 11. Delivery-PR revision loop

Input: team behavior feedback on delivery PR 42 after the prior agentic head was approved and promoted.

Result: `delivery-follow-up` on the original branch. The agent asked for a product decision, invalidated old scoped write authority, implemented only agentically, renewed the entire exact-SHA gate, and planned to cherry-pick new cargo to the same PR. Merge remained human-only.

### 12. Synchronization and finalization

Fixture: the separate `finalized-ledger` snapshot continues scenario 11 after the authorized PR-42 update and human merge. It archives the same `feature/delivery-feedback` work branch, delivery PR 42, and agentic PR 9; the active shard is absent from that finalized ledger tip.

Result: the agent required fast-forward ancestry, made delivery main authoritative, planned agentic-main fast-forward, closed the agentic PR without merge, retained development evidence, and finalized only after all SHAs, feedback mappings, gates, and evidence were complete. The retained event and archive map feedback, QA/acceptance, independent review, authorized cargo transfer with before/after delivery SHAs, delivery PR state, merge result, main synchronization, and agentic-PR closure for one continuous run.

### 13. Concurrent runs

Fixture: eight active runs use disjoint branch-named directories and nine immutable uniquely named events.

Result: status can discover manifests recursively without a shared mutable run table. The store instructions restrict workers to exact event-file commits, coordinators to explicitly owned paths, and Git lock contention to reread-and-retry without automatic lock deletion.

## Recommendation

Continue the Slipway experiment. The prototype now covers Jim's planning, building, private-metadata, team-feedback, synchronization, portfolio, and recovery workflow without adding a harness. Trial it on non-critical deliveries beside Shipyard. Retain selected Shipyard enforcement only where real trials demonstrate that instructions, exact-SHA review, scoped Git operations, and plain durable state are not sufficient.
