# Slipway validation

## Original prototype evidence

The behavioral scenarios below were validated locally on 2026-08-04 on branch `experiment/slipway`. The machine-local worktree path is intentionally omitted from product cargo. These are historical prototype results; they do not claim to validate the later source-only branch reconstruction or a global host installation.

No GitHub/Linear write, network provider mutation, remote edit, authentication change, push, PR mutation, merge, force-push, deployment, or branch deletion occurred during those scenarios.

## Source-only rewrite evidence

The source-only reconstruction was validated on 2026-08-05 against shared base `7bfe2565d9ef2bc1af6f5caacc298aa32e5efbaa`, reviewed agentic candidate `9750e0cda9394c2be73325b42298073fa81d21c9`, and patch-equivalent delivery candidate `8fad279cf54c8bfdb48539688af8eb4813e928a7`. The machine-local worktree paths are intentionally omitted. The official validator passed all eight skills, all eight `agents/openai.yaml` files parsed, relative Markdown links resolved, `git diff --check` passed, and package-content and per-commit forbidden-path inspection passed. Both reachable candidates contained no root `.agents/`, `.cursor/`, `.claude/`, or `build/` paths.

Every accepted delivery-feedback revision receives the same checks at its new exact candidate SHA. The current exact SHA and renewed QA/review evidence live in the branch-named external Slipway ledger and delivery PR because a Git commit cannot embed its own final SHA truthfully.

Fresh Cursor IDE, Cursor CLI, Codex, and Claude Code discovery remains a post-merge installation check. It cannot be claimed before authoritative delivery `main` contains the suite and the user authorizes copying it to the global skill roots.

## Static validation

- Source-repository Codex tooling is validated independently with strict config
  loading, a feature listing for multi-agent support, whitespace checks, and a
  staged-distribution boundary check. Those checks confirm the root `AGENTS.md`
  and `.codex/` contributor tooling neither alters a skill nor enters a staged
  eight-directory Slipway suite.
- The official skill-authoring `quick_validate.py` passed all eight skills: `slipway`, setup, status, resume, review, sync, promote, and finalize. The validator's missing PyYAML dependency was installed only into a temporary directory and is not a project dependency.
- YAML inspection confirmed that every `agents/openai.yaml` has the intended display name, a 25–64 character short description, and a default prompt containing its literal `$slipway-*` invocation.
- A local link check resolved every relative Markdown link.
- The package contains only Markdown and YAML files. It contains no script, executable, TypeScript, service, schema runtime, state machine, provider adapter, or Git abstraction.
- Canonical skills live only under `packages/slipway/skills/`; the clean cargo branch tracks no root `.agents/`, `.cursor/`, `.claude/`, generated `build/`, or host plugin artifacts. This source-only rule was renewed against the reconstruction described above, not inferred from the original prototype run.
- `git diff --check` passed.
- In the original `experiment/slipway` worktree, the pre-existing TypeScript source, tests, package manifests, active Shipyard skills, and root README matched accepted SHA `d03351135a44e9f2017ae1dedb646d488d33824c` exactly. The clean `feature/slipway` cargo branch is intentionally based on the repositories' shared bootstrap `main` and adds only the standalone Slipway package plus repository-level ignore policy; it does not claim to contain the unmerged Shipyard policy-engine branch.
- Run-fixture validation found eight unique, path-disjoint active work-branch identities, one non-reused archived identity, nine globally unique immutable active-snapshot events, no shared global `status.md`, a matching worker/reviewer exact SHA, and identical delivery/agentic main SHAs after finalization. A retained-tag snapshot records the authorized PR-42 transfer, and a separate finalized-ledger snapshot preserves the same branch/PR identity through merge while omitting its former active shard. Every fixture manifest, status, gate, artifact, event, and archive record follows the current reusable asset contract.

## Source-repository orchestration verification (#19)

This is a contributor-tooling check, not a claim that installed Slipway skills
load Codex configuration. The accepted Codex 0.144.4 compatibility exception is
recorded on [spec #16](https://github.com/visualjc/agentic-shipyard/issues/16#issuecomment-5443984317)
and [ticket #17](https://github.com/visualjc/agentic-shipyard/issues/17#issuecomment-5443984506):
use the strict-client `features.multi_agent` plus `agents.max_threads` form and
always select a named role for delegated work. Do not add unsupported
`agents.enabled` or `default_subagent_*` keys.

The following reproducible record passed against the source tree and a fresh
staging directory. Set `repo_root=$(git rev-parse --show-toplevel)` and
`stage_dir=$(mktemp -d)`; retain the run's exact candidate SHA in its immutable
review event because a commit cannot truthfully contain its own final SHA.

```bash
cd "$repo_root"
skill_names=(slipway slipway-setup slipway-status slipway-resume slipway-review slipway-sync slipway-promote slipway-finalize)
validator_dir=$(mktemp -d)
python3 -m pip install --quiet --target "$validator_dir/site" PyYAML
curl -fsSL https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/scripts/quick_validate.py -o "$validator_dir/quick_validate.py"
for skill_name in "${skill_names[@]}"; do
  PYTHONPATH="$validator_dir/site" python3 "$validator_dir/quick_validate.py" "packages/slipway/skills/$skill_name"
  cp -R "packages/slipway/skills/$skill_name" "$stage_dir/$skill_name"
  PYTHONPATH="$validator_dir/site" python3 "$validator_dir/quick_validate.py" "$stage_dir/$skill_name"
done
test "$(find "$stage_dir" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" = 8
```

The PyYAML dependency is isolated under `$validator_dir`; it is not a project
dependency. The role assertion uses the same six-element list and exact
`name`, `model`, `model_reasoning_effort`, and `sandbox_mode` values from the
role files before checking the QA instruction text.

- `codex --strict-config doctor --summary` loaded the configuration, and
  `codex features list | rg '^multi_agent\\s'` reported `multi_agent` enabled.
  The doctor still reports host-local terminal and rollout-state conditions;
  they do not invalidate config parsing.
- A fresh read-only Codex probe listed exactly `context_gatherer`,
  `repo_knowledge`, `planner`, `developer`, `qa_tester`, and `reviewer` with
  their pinned model, reasoning effort, and sandbox. Independent TOML
  assertions require those six names and settings, reject duplicates, and
  confirm QA remains Luna/high with a workspace-write sandbox plus its
  no-source-edit/no-rewriting-formatter instruction.
- Run the official `quick_validate.py` once for each of the eight source skill
  directories and again after copying those same directories to `$stage_dir`.
  Both exact-eight runs pass; the staged directory names must equal
  `slipway`, `slipway-setup`, `slipway-status`, `slipway-resume`,
  `slipway-review`, `slipway-sync`, `slipway-promote`, and
  `slipway-finalize`.
- The forbidden-path and staged-isolation checks pass: neither source skill
  changes nor staging contains `AGENTS.md`, `.codex/`, custom-agent TOML, live
  private context/cache such as `.slipway-local/context` or the ledger's
  `.slipway/context`, credentials, or machine-specific absolute paths. Reviewed
  reusable context templates under included product paths, including
  `slipway/assets/context/`, remain intentional suite content. Relative
  Markdown links resolve, and secret/path scans find no committed credential or
  personal-path value.
- A disposable unrelated Git repository remains without root `AGENTS.md` or
  `.codex/` after a read-only Codex probe. This proves this repository's
  contributor tooling is neither created nor required outside the source tree.
- Negative checks pass when strict loading rejects an injected unsupported
  `agents.enabled` setting and when the exact-eight staging assertion rejects a
  ninth directory. These failures are required evidence, not successful
  configurations.
- The fresh orchestration check records the ordered roles: Luna/low discovery,
  Terra/medium planning, Sol/high approval, one Terra/medium implementation
  writer, concurrent Luna/high QA and Terra/high independent review, then Sol
  reconciliation. Sol does not edit product files, implement product changes,
  or run QA; fix loops return serially to the sole developer and renew evidence
  for the resulting exact candidate SHA.

The lightweight record does not claim fresh global-host installation,
Cursor/Claude discovery, provider mutation, or a clean host environment. Those
checks remain unavailable or intentionally skipped here; the residual risk is
host-version drift and the ordinary limits of instruction-enforced role
separation.

## Private context-module evidence

The focused `prototypes/context-modules/` scenario validates the accepted
boundary without a host or failure matrix. One disposable Repo-B fixture loads
`project-policy`, `matt-skills`, and `codegraph` from a ledger context tree,
records the selected modules, passes selected entrypoints to one worker, skips
CodeGraph when its optional capability is absent, and leaves the application's
tracked tree unchanged. The prototype and its evidence remain outside product
cargo.

This evidence proves Slipway-directed context selection and propagation only.
It does not claim automatic discovery by Codex, Cursor, Claude Code, or an
arbitrary session that bypasses Slipway. The delivery repository requires no
tracked bootstrap and has zero awareness of the private context system.

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

Continue the Slipway experiment. The validation evidence now covers Jim's planning, building, private-metadata, team-feedback, synchronization, portfolio, and recovery workflow without adding an executable harness to product cargo. Trial it on non-critical deliveries beside Shipyard. Retain selected Shipyard enforcement only where real trials demonstrate that instructions, exact-SHA review, scoped Git operations, and plain durable state are not sufficient.
