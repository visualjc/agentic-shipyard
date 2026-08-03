# Findings: worktree graph freshness

Status: complete  
Executed: 2026-08-03  
Prototype: [`prototype.mjs`](prototype.mjs)  
Research basis: [`../../research/graph-tool-constraints.md`](../../research/graph-tool-constraints.md)

## Verdict

The exact-source synthetic exercise passed 21 assertions. It validates
Shipyard's tool-independent cache contract and supports two experimental local
adapters with strict wrappers. It does not justify a universally required graph
tool.

- **Graphify 0.9.32:** optional experimental v1 candidate.
- **CodeGraph 1.5.0:** optional experimental v1 candidate with stronger runtime
  and repository-exclusion preflights.
- **Understand Anything 2.9.4:** deferred as an authoritative feature-worktree
  graph; its deterministic scanner is usable as a freshness input only when the
  worktree redirect is disabled.

Final supported/experimental/deferred wording remains ticket 19's decision.

## Synthetic scenario

The fixture began with `shipyardAdd` on clean `main`. Feature A introduced
`shipyardMultiply`; sibling feature B introduced `shipyardSubtract`. The
exercise then:

1. built an exact-main baseline;
2. copied it into private worktree caches;
3. incrementally refreshed each divergent feature;
4. introduced and reverted an uncommitted `shipyardDivide` function;
5. queried from fresh CLI processes;
6. advanced `main` with `shipyardFormat` and rebased feature A;
7. checked out the pre-feature parent and returned to the feature branch;
8. removed and recreated the feature worktree at the same path; and
9. exercised stale-lock and unavailable-tool fallback states.

Feature A always saw its own changes plus the baseline it had incorporated.
Feature B never saw feature A's symbol. Stale state was never authoritative.

## Graphify

Graphify successfully used an external exact-main cache as a copy seed, then
detected committed and uncommitted changes incrementally. Its external cache
survived process restart and worktree recreation, and the rebased graph contained
both `shipyardFormat` and `shipyardMultiply`.

The prototype discovered that `--out <external-root>` alone still wrote
`graphify-out/cache/stat-index.json` inside the scanned worktree at this exact
version. Setting `GRAPHIFY_OUT` to an absolute external
`<cache-root>/graphify-out` path in addition to `--out` prevented the leak. The
adapter must enforce and verify both settings, use `--code-only`, disable query
logging, and fail if any generated path appears in the product tree.

Baseline copying is therefore empirically viable at the reviewed commit, but it
should remain behind an experimental profile flag until tested on a realistic
multi-language repository and upgraded only through a reviewed compatibility
change.

## CodeGraph

Copying the baseline `.codegraph` directory into each worktree worked on the
reviewed commit even though upstream does not document portable baseline
seeding. Incremental sync correctly isolated siblings, observed uncommitted
edits, handled rebase and checkout, and reused a backed-up index after same-path
worktree recreation.

Two hidden integration requirements emerged:

1. The machine's default Node 22.13.0 build exposes `node:sqlite` without FTS5,
   causing `codegraph init` to fail with `no such module: fts5`. The already
   installed Node 24.13.1 passed the FTS5 probe and ran CodeGraph successfully.
   Shipyard must probe the actual runtime capability, not merely compare a Node
   version string.
2. CodeGraph creates `.codegraph/.gitignore`, but that file itself can be staged
   by a broad `git add -A`. Before initialization or cache restore, Shipyard must
   add `.codegraph/` to the repository's machine-local Git `info/exclude` and
   verify the product tree remains clean.

Because the cache is worktree-local and seeding is an observed rather than
documented guarantee, CodeGraph remains experimental despite passing the
fixture.

## Understand Anything

The deterministic local scanner produced distinct content fingerprints for the
two feature worktrees and detected uncommitted, rebased, and recreated state.
With default skill behavior, however, a worktree invocation resolved to the main
checkout and produced the clean-main fingerprint. Setting
`UNDERSTAND_NO_WORKTREE_REDIRECT=1` was necessary to describe the feature.

The exercise intentionally did not invoke the semantic LLM phase. It therefore
does not prove per-worktree knowledge-graph storage, provider privacy, cache
seeding, or semantic incremental refresh. Understand Anything remains deferred
for authoritative feature state; a clearly labeled exact-main graph may still
serve as non-authoritative orientation.

## Adapter freshness contract

Every adapter produced or was wrapped by a descriptor containing:

- exact reviewed tool source;
- cache identity and private worktree root;
- indexed Git commit; and
- working-tree content fingerprint.

A commit or fingerprint mismatch returned `stale`. A stale lock returned
`blocked` and required verified recovery. An unavailable tool returned
`fallback`, telling the agent to inspect source directly rather than blocking
development or trusting old graph output.

## Indicative timing

On the tiny JavaScript fixture, the clean repeatability run measured:

| Operation | Graphify | CodeGraph |
| --- | ---: | ---: |
| Initial build | 1,190 ms | 592 ms |
| Baseline seed copy | 2 ms | 1 ms |
| Feature refresh | 145 ms | 275 ms |
| Dirty-tree refresh | 141 ms | 263 ms |

Preparing all three exact-source temporary tool environments took 37,955 ms.
These figures prove the mechanism is practical on the fixture; they are not
performance promises for production repositories.

