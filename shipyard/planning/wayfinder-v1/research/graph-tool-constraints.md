# Research: graph-tool constraints for Shipyard v1

Status: complete  
Evidence captured: 2026-08-03

## Decision

Shipyard v1 should standardize a tool-independent graph freshness and cache
contract, but it should not make any graph product universally required.

- Prototype Graphify first as the optional experimental adapter. Its output can
  be relocated outside the worktree and its cache uses relative paths that can
  be re-anchored after copying.
- Treat CodeGraph as an optional per-worktree local index. Its documented model
  explicitly expects a separate index in each worktree; baseline seeding is not
  an upstream guarantee and must be measured before Shipyard promises it.
- Defer Understand Anything as an authoritative feature-worktree graph until a
  wrapper proves no-redirect operation, per-worktree storage, and freshness.
  Its default worktree behavior analyzes the main checkout instead of the
  divergent feature worktree.

The reusable v1 contract is therefore: an immutable baseline may seed a new
worktree cache only when an adapter proves that operation; divergent worktrees
never share one mutable graph; and every graph is checked against both the
current commit and a working-tree fingerprint before an agent treats it as
authoritative.

## Evidence snapshot

The reviewed source snapshots are:

| Tool | Reviewed source | License |
| --- | --- | --- |
| CodeGraph 1.5.0 | `colbymchenry/codegraph@49c11fc2e0c02170742be8411e66a31af611f4b7` | MIT |
| Graphify 0.9.32 | `Graphify-Labs/graphify@00efd6e7969837ae4a9f11d8d504dcd3b20b09df` | Apache-2.0 or MIT |
| Understand Anything | `Egonex-AI/Understand-Anything@fe8c5bc591716aafd79b4765549328f08ef5a52e` | MIT |

No behavior below should be generalized to a later version without a new
review.

## CodeGraph

CodeGraph builds a local SQLite index in `.codegraph/codegraph.db` using
tree-sitter and does not require an LLM. It supports manual and watched
incremental synchronization and surfaces staleness/catch-up state.
[CodeGraph README](https://github.com/colbymchenry/codegraph/blob/49c11fc2e0c02170742be8411e66a31af611f4b7/README.md)

Its worktree handling is deliberately per-worktree. When it detects an index
belonging to a different worktree, it warns and instructs the user to initialize
an independent index in the current worktree.
[CodeGraph worktree handling](https://github.com/colbymchenry/codegraph/blob/49c11fc2e0c02170742be8411e66a31af611f4b7/src/sync/worktree.ts)

`CODEGRAPH_DIR` changes the directory name inside the project, but the current
implementation rejects separators and absolute paths. CodeGraph therefore has
no documented way to place its live index in a central Shipyard cache.
[CodeGraph directory rules](https://github.com/colbymchenry/codegraph/blob/49c11fc2e0c02170742be8411e66a31af611f4b7/src/directory.ts)

Implications:

- supported storage is a project/worktree-local directory;
- separate indexes match Shipyard's no-shared-mutable-state rule;
- copying a baseline database may be technically possible but is not a
  documented portable-cache guarantee;
- Shipyard must either accept an ignored worktree-local `.codegraph` directory
  or use an explicitly tested link/copy wrapper; and
- the MCP/host installer should not run implicitly because it edits host
  configuration and instruction files.

CodeGraph documents anonymous telemetry that excludes code, paths, and queries,
and provides `codegraph telemetry off`, `CODEGRAPH_TELEMETRY=0`, and
`DO_NOT_TRACK` controls. Shipyard's proprietary-code profile should require the
off state even though parsing itself is local.
[CodeGraph telemetry](https://github.com/colbymchenry/codegraph/blob/49c11fc2e0c02170742be8411e66a31af611f4b7/TELEMETRY.md)

Classification: **optional, experimental until the seed/update prototype**.

## Graphify

Graphify uses tree-sitter for code and can run in a code-only offline mode.
Documentation, PDFs, and images may invoke a configured LLM, so those inputs are
a different privacy class from `--code-only`.
[Graphify README](https://github.com/Graphify-Labs/graphify/blob/00efd6e7969837ae4a9f11d8d504dcd3b20b09df/README.md)

Graphify supports an output path through `--out`/`--output` or `GRAPHIFY_OUT`,
including an absolute path. Its path helper and atomic writers are compatible
with external directories and symlinks.
[Graphify output paths](https://github.com/Graphify-Labs/graphify/blob/00efd6e7969837ae4a9f11d8d504dcd3b20b09df/graphify/paths.py)

The incremental cache stores relative paths and re-anchors them when it is
loaded under another project root. Content hashes drive update decisions, and
the graph records the commit at which it was built.
[Graphify portable cache](https://github.com/Graphify-Labs/graphify/blob/00efd6e7969837ae4a9f11d8d504dcd3b20b09df/graphify/cache.py)
[Graphify detection](https://github.com/Graphify-Labs/graphify/blob/00efd6e7969837ae4a9f11d8d504dcd3b20b09df/graphify/detect.py)

Implications:

- it is the strongest candidate for an external machine-local cache;
- an immutable baseline copy can plausibly seed a per-worktree cache, but the
  exact copy/update result remains a prototype question;
- its documented shared-output option must not be used as one mutable output
  for divergent worktrees;
- watch or post-commit updating can help, but session startup must still verify
  the current commit and dirty-tree fingerprint; and
- Shipyard should wrap the narrow code-only CLI instead of running installation
  helpers that write repository agent instructions and hooks.

Graphify has no reported telemetry, but query logging is enabled by default at
`~/.cache/graphify-queries.log`; the proprietary-code profile should set
`GRAPHIFY_QUERY_LOG_DISABLE=1`. Its dual Apache-2.0/MIT distribution includes a
`NOTICE`; any future vendoring must preserve the selected license obligations
and applicable notice.
[Graphify Apache license](https://github.com/Graphify-Labs/graphify/blob/00efd6e7969837ae4a9f11d8d504dcd3b20b09df/LICENSE)
[Graphify MIT license](https://github.com/Graphify-Labs/graphify/blob/00efd6e7969837ae4a9f11d8d504dcd3b20b09df/LICENSE-MIT)
[Graphify notice](https://github.com/Graphify-Labs/graphify/blob/00efd6e7969837ae4a9f11d8d504dcd3b20b09df/NOTICE)

Classification: **optional experimental v1 adapter and first prototype
candidate**.

## Understand Anything

Understand Anything writes a semantic graph under `.ua/knowledge-graph.json`
(or a legacy directory when already present), records the analyzed Git commit,
and uses fingerprints for incremental analysis.
[Understand Anything README](https://github.com/Egonex-AI/Understand-Anything/blob/fe8c5bc591716aafd79b4765549328f08ef5a52e/README.md)
[Fingerprint implementation](https://github.com/Egonex-AI/Understand-Anything/blob/fe8c5bc591716aafd79b4765549328f08ef5a52e/packages/core/src/fingerprint.ts)

Its skill redirects a worktree invocation to the main repository root by
default. `UNDERSTAND_NO_WORKTREE_REDIRECT=1` disables that behavior. Without the
override, a graph consulted during feature work can describe clean `main`
instead of the feature code the agent is changing.
[Understand skill worktree rules](https://github.com/Egonex-AI/Understand-Anything/blob/fe8c5bc591716aafd79b4765549328f08ef5a52e/understand-anything-plugin/skills/understand/SKILL.md)

There is no documented general output-directory override comparable to
Graphify's. Initial semantic analysis also consumes host-model tokens, so
provider and data-residency behavior depends on the active agent platform rather
than a tool-guaranteed local-only mode. Commit comparison supports incremental
updates, but feature work containing uncommitted changes still needs a separate
working-tree freshness check.
[Understand staleness implementation](https://github.com/Egonex-AI/Understand-Anything/blob/fe8c5bc591716aafd79b4765549328f08ef5a52e/packages/core/src/staleness.ts)

Classification: **deferred for authoritative feature-worktree use**. A baseline
graph may still be useful for read-only orientation if clearly labeled with its
main SHA and never presented as current feature state.

## Privacy test policy

Synthetic or public fixtures are required for:

- any Graphify mode that submits documentation, images, or text to an LLM;
- Understand Anything unless the profile explicitly approves the active host
  model and provider for that repository; and
- first-time experiments with an unreviewed plugin, installer, hook, or MCP
  integration.

Proprietary JustGames code may be used only after explicit approval and only in
a reviewed local-structure mode:

- CodeGraph with telemetry disabled; or
- Graphify `--code-only` with query logging disabled.

The local-lifecycle and graph-seeding prototypes should use generated synthetic
repositories. No graph tool needs access to a production clone to answer the
v1 mechanics.

## Adapter contract for ticket 14

The prototype should give each graph adapter the same observable contract:

```text
baseline(repo, exact_main_sha) -> immutable cache descriptor
seed(baseline, worktree, exact_head_sha) -> private worktree cache
refresh(cache, head_sha, working_tree_fingerprint) -> fresh descriptor
status(cache, head_sha, working_tree_fingerprint) -> fresh | stale | invalid
```

It should empirically measure Graphify baseline copy plus incremental refresh,
CodeGraph per-worktree initialization and refresh, and—on a synthetic fixture
only—Understand Anything's default redirect versus
`UNDERSTAND_NO_WORKTREE_REDIRECT=1`. A pass requires isolation between two
divergent worktrees and detection of both committed and uncommitted changes.

This research resolves product classification and safety policy. It does not
promote any adapter from experimental status; ticket 14 owns that evidence.

