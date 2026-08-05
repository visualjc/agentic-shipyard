# Slipway architecture

Slipway is a skills-first coordinator for a paired agentic and delivery repository. It is a separate product from Shipyard, the TypeScript policy engine. The prototype intentionally keeps its center of gravity in concise Markdown playbooks, exact agent/reviewer briefs, and inspectable Git-backed records.

## Agent-directed behavior

The agent classifies effort, explains the route, invokes installed skills, chooses ticket and worker boundaries, reconciles evidence, asks product questions, and names the next action. Matt Pocock's skills provide the baseline planning/build/review flow. Pstack may replace only the building phase after explicit selection.

Slipway coordinates these capabilities rather than restating their artifacts. Wayfinder owns decision maps. Grilling/domain modeling owns requirement decisions. Research and prototype own question artifacts. To-spec and to-tickets own implementation contracts and blocker edges. Implement/TDD own ticket implementation. Code-review owns independent findings.

`packages/slipway/skills/` is the only canonical source for the eight-skill suite. Do not track root `.agents/`, `.cursor/`, `.claude/`, generated `build/`, or other host installation artifacts in the product repository. Install all eight folders atomically into the host's global skill root by following [distribution/README.md](../distribution/README.md). The seven direct commands are intentionally thin entry points into the primary skill's shared playbooks, references, and assets; they are not standalone packages.

## Durable state

Portable state lives on the parallel `slipway-ledger` branch. Machine-local paths live in an ignored binding. A run is identified by its unique complete agentic work-branch name and owns one disjoint shard. The coordinator owns its mutable manifest, status, gates, artifact index, and exact agentic/delivery PR pointers. Workers and reviewers add immutable events.

Status scans active manifests and branch-specific archive summaries. It does not require every run to rewrite one global table. Finalization compresses a completed run into its disjoint archive summary and removes the active shard from the ledger tip; Git history and an optional retained development tag preserve detailed evidence.

Git's index and ref locks serialize commits but do not provide a Slipway transaction system. Scoped `git commit --only` operations reduce accidental cross-run commits. Busy locks and failed ref updates cause reread-and-retry, never automatic lock deletion.

## Product flow

```text
delivery main -> fast-forward -> agentic main -> agentic work branch
                                               |
                                               +--> private agentic PR (close, never merge)
                                               |
                                               | reviewed product-only commits
                                               v
                                      delivery PR branch
                                               |
                                      human merge to delivery main
                                               |
                              fast-forward agentic main; close agentic PR
```

Team feedback is read from the delivery PR and implemented on the same agentic work branch. Every revision renews the exact-SHA delivery gate before new product commits are cherry-picked to the same delivery PR.

## Fixture cargo

`packages/slipway/examples/dry-run/` is intentional product cargo. Its records are synthetic conformance examples for the durable-store format and lifecycle playbooks, not copies of an active ledger or private run evidence. They make pause/resume, exact-SHA review, promotion, concurrent run sharding, and finalization inspectable without a runtime. Live `.slipway/` state, machine bindings, worker/reviewer events, PRDs, research, prototypes, and other run-specific agentic artifacts remain excluded from delivery cargo.

## Helper code

No helper code is necessary in this iteration. Installation is a documented direct copy from canonical source to global host skill roots; no installer or generated build tree is tracked. Slipway adds no service, executable, schema runtime, state machine, provider adapter, Git abstraction, or validation program. Pstack's `orch` demonstrates when a bookkeeping helper can earn its cost at program scale, but Slipway first removes shared writes through run sharding.

A future helper must be proposed before implementation and justified by repeated observed failures. Its scope must remain atomic file replacement, validation, status rendering, or similarly deterministic bookkeeping. It must not own lifecycle policy.

## Guarantees intentionally absent

Skills can require preflight and evidence, but cannot force an agent to comply. Plain files do not enforce authorization, credential scope, path ownership, lock fairness, atomic multi-file updates, idempotency, provider truth, or safe conflict resolution. Git/provider permissions and protected branches remain the real boundaries. External writes require exact target/account preflight; irreversible operations remain human-gated.
