# Shipyard product premise

Status: Wayfinder complete; CCPM PRD synthesized; no implementation has begun  
Updated: 2026-08-03

## Premise

Agentic development produces more than source code. Effective workflows create
plans, state, knowledge graphs, context overlays, acceptance evidence, review
records, and other scaffolding. That material can be valuable to the agents
doing the work without belonging in the repository consumed by the wider team.

Shipyard gives agents a governed development environment with the scaffolding
they need, then delivers only the reviewed code, tests, documentation, and
evidence that the destination repository has agreed to receive.

> Shipyard keeps the scaffolding in the yard and launches only the reviewed
> cargo.

Shipyard is intended to support mixed-adoption teams: an individual developer
can use a rich agentic workflow without requiring every collaborator to adopt
the same tools or maintain their metadata. It also supports AI-native projects
that intentionally share selected agentic records in their main repository.

## Lineage and development toolchain

Shipyard is an opinionated agentic-development workflow built around [Matt
Pocock's composable engineering skills](https://github.com/mattpocock/skills),
[CCPM's](https://github.com/automazeio/ccpm) PRD and execution model, and
host-specific agent tooling such as [Cursor
Pstack](https://github.com/cursor/plugins/tree/main/pstack). Shipyard supplies
the lifecycle, isolation boundaries, metadata policy, review gates, and
promotion model that connect those systems. It does not replace them; it
defines how they work together safely and repeatably.

The intended development toolchain has distinct roles:

- Discovery and planning use `grilling`, `grill-with-docs`, `wayfinder`,
  `research`, `prototype`, `to-spec`, and `to-tickets`.
- Requirements and diagnosis use `domain-modeling` and `diagnosing-bugs` when
  their questions arise.
- Development quality uses `tdd`, `code-review`, and
  `resolving-merge-conflicts`, with skills such as `codebase-design`,
  `implement`, and `triage` available as situational support.
- Large-work project state and multi-agent execution use CCPM.
- Cursor execution and review use Pstack; Claude Code and Codex use their
  configured CCPM and Shipyard host adapters.

This is the supported first-party path, not a claim that every installed skill
is required for every delivery. The exact required subset, compatible versions,
and host guarantees remain a Wayfinder research item before the v1 PRD.

## Dependency ownership and distribution

Shipyard owns its workflow engine, profiles and schemas, public skills, host
adapters, compatibility checks, and documentation. Third-party systems remain
external dependencies by default rather than copied into a `vendor/` tree.
Shipyard will record their upstream source, reviewed SHA or version, required
capabilities, and tested compatibility in a machine-readable dependency
manifest, with progressive documentation linking to the original projects.
Setup and status will eventually verify that contract and fail with actionable
installation guidance when it is not met.

Matt Pocock's skills remain managed through their existing reviewed,
SHA-pinned installation package while Shipyard is developed. Pstack remains a
Cursor-managed plugin. The maintained CCPM fork remains an external pinned
dependency. Vendoring is reserved for a separately justified case such as an
unavailable upstream or a necessary patch that cannot be maintained upstream.

The existing user-owned `yolo-*` skills are source material Shipyard may own,
but they will not be mechanically renamed one-for-one. Their execution,
recovery, context-recycling, and review behavior will be extracted into the
appropriate Shipyard public workflow or internal host adapter. Temporary
delegating aliases may preserve compatibility until the Shipyard replacements
pass end-to-end validation; the old names can then be retired deliberately.

## Product boundary

Shipyard is a generic workflow product, not a JustGames-specific command suite.
Its reusable engine, skills, schemas, tests, and progressive documentation will
live here and may eventually become an independent open-source repository.

Real deployment policy lives beside it in `../shipyard-config/`. That sibling
package will hold profiles such as `justgames` and `visualjc`, repository
allowlists, path policies, and private context overlays. Credentials, repository
bindings, worktree registrations, caches, and locks remain machine-local.

## Shared workflow

Profiles select the common `reviewed-delivery` workflow:

1. Classify work as large, small, bug, or review-only.
2. Produce the appropriate requirements and acceptance contract.
3. Execute through the configured host adapter.
4. Open a development pull request.
5. Audit acceptance against an exact SHA.
6. Run independent review in a separate session or agent context.
7. Revise and repeat evidence whenever the SHA changes.
8. Promote the approved payload according to the repository topology.
9. Require the destination's normal human merge.
10. Finalize by archiving evidence, synchronizing the baseline, and cleaning up.

Large work uses Wayfinder followed by a CCPM PRD and vertical CCPM tasks. Small,
settled work uses grill-with-docs followed by `to-spec`, with `to-tickets` only
when multiple independent vertical slices add value. Cursor executes through
Pstack; Claude Code and Codex use CCPM's default multi-agent execution flow.

## Topologies

`staged-pair` binds a development repository and a destination repository. The
development repository owns planning, repeated agentic review, durable ledger
records, and the exact reviewed SHA. Promotion creates or updates a normal
destination-owned pull request from a sanitized product payload. It never uses
a fork pull request.

`single-repository` uses one repository for development and destination. Its
existing pull request is certified and marked ready after exact-SHA review; no
second pull request is created and Shipyard does not merge automatically.

In both topologies, the authoritative development `main` is a clean mirror of
the configured destination `main`. Product work occurs on feature branches and
worktrees, never on `main`.

## Metadata policies

`development-only` confines all Shipyard records to the development repository,
its ledger, and machine-local caches. It is the primary mixed-adoption mode.

`shared` permits selected durable Shipyard records in the destination according
to explicit path rules. Shared means allowed, not automatically published.
Secrets, scratch data, caches, and unclassified paths are prohibited in every
mode.

Every relevant path has one owner and one behavior: product, development
record, development-generated, company-only, context overlay, or scratch.
Unclassified changed paths fail closed during synchronization and promotion.

## Ledger and context

Every development repository may have a parallel `shipyard-ledger` branch. It
is never an ancestor of product feature branches and is never copied to a
destination repository. It checkpoints PRDs, specs, acceptance evidence, review
findings, promotion manifests, and optional curated graph snapshots throughout
delivery. Finalization also creates an annotated development-only tag pointing
to the exact reviewed product SHA.

Shipyard-aware tasks receive a small, pinned context envelope containing the
profile, topology, repository, delivery ID, product SHA, ledger SHA, and paths
to role-relevant records. Agents load only what their role requires. They read
ledger content without switching the product worktree.

Team-owned repository context, profile-owned development context, and
delivery-specific context are distinct layers. Shipyard never silently merges
two meanings at the same Git path.

## Knowledge graphs and worktrees

Durable reasoning records are committed to the ledger. Rebuildable indexes and
graphs remain machine-local by default, with profile-controlled opt-in for
curated snapshots.

Each repository can maintain a baseline graph for an exact `main` SHA. A new
worktree seeds a worktree-specific cache from that baseline and incrementally
updates it. Divergent worktrees never share one mutable graph. Every session
verifies freshness against the current commit and working-tree fingerprint
before treating graph output as authoritative.

## Safety and public interface

The intended public skills are:

- `shipyard`
- `shipyard-setup`
- `shipyard-status`
- `shipyard-review`
- `shipyard-sync`
- `shipyard-promote`
- `shipyard-finalize`
- `shipyard-help`

All operational skills fail closed when they cannot resolve and validate the
repository binding. Setup binds complete topology units, validates but does not
provision repositories or rewrite remotes, and requires explicit `--rebind` to
replace stale state. Worktrees inherit a bound clone's identity through Git's
shared repository metadata.

GitHub actors are profile policy, separate from repository owners. Shipyard
selects credentials per command without changing the machine-wide active
GitHub CLI account. Mutations use short per-repository locks; read-only status
does not.

Synchronization is clean and explicit. It fast-forwards the development
baseline from its authoritative destination. Explicitly requested company
branches or tags arrive only as local, read-only source refs. Sync never rebases
feature work, resolves conflicts, force-pushes, promotes, or finalizes.

Staged-pair promotion begins with one sanitized product commit. Company review
revisions are made and re-reviewed in the development repository, then appended
to the existing destination pull request as sanitized revision commits. No
company pull-request branch is force-pushed. Every creation or update must be
based on current destination `main` and a newly approved exact SHA.

## Current state

The predecessor `../justgames-agentic-workflow/` contains installed,
JustGames-specific skills and the decision history that led here. Its safety
audits intentionally fail because the planned personal clone topology has not
been provisioned. `~/projects/justgames-jim/` does not yet exist, only the
`justgamesjim/just-flip` mirror is reported to exist, and `just-jim` is absent
from the predecessor allowlist.

Shipyard planning must not provision those repositories or migrate production
remotes. Empirical work used disposable local repositories and the explicitly
approved private VisualJC/NativeInteractive fixtures. Real repository onboarding
is a post-implementation pilot.

## Wayfinder

The completed planning map is
[`shipyard-v1/map.md`](.scratch/shipyard-v1/map.md). Settled decisions are
preserved as resolved child tickets, and the synthesized CCPM PRD is
[`shipyard-v1.md`](.scratch/shipyard-v1/.claude/prds/shipyard-v1.md).
