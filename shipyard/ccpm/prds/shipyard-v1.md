---
name: shipyard-v1
description: Govern rich agentic development while delivering only reviewed, destination-approved cargo.
status: backlog
created: 2026-08-03T23:16:49Z
---

# PRD: Shipyard v1

## Executive Summary

Shipyard is an opinionated agentic-development workflow for people who want
plans, PRDs, specs, knowledge graphs, context overlays, review records, and
multi-session state without forcing all of that scaffolding into the repository
their wider team maintains.

Shipyard governs a shared `reviewed-delivery` lifecycle. Agents work in a bound
development environment, prove acceptance and independent review against an
exact source SHA, and deliver only policy-approved code, tests, and
documentation. A staged-pair profile promotes sanitized changes into a normal
destination-owned pull request; a single-repository profile certifies its
existing pull request. Shipyard never merges on behalf of the destination's
human process.

V1 supports Codex as its live execution/review host and GitHub as its tracker
and pull-request provider. Matt Pocock's engineering skills and the maintained
CCPM skill-layout fork remain pinned external dependencies. Graphify and
CodeGraph may be enabled experimentally; other hosts and integrations remain
explicitly deferred.

## Problem Statement

Agentic development needs durable context and generated working state, but
mixed-adoption teams often do not want that material in their normal code
repository or pull requests. Existing agent workflows also blur important
authority boundaries:

- a tool may infer the wrong GitHub account or write issues to the wrong owner;
- generated PRDs, graphs, and context may leak into team history;
- a reviewer may approve one SHA while later changes silently invalidate the
  evidence;
- a personal development PR may be mistaken for a cross-repository fork PR;
- synchronization, promotion, merging, and cleanup may be conflated;
- host-specific context may be inherited implicitly or loaded too broadly; and
- a failed external mutation may leave no safe, deterministic resume point.

Shipyard must make those boundaries explicit, inspectable, and fail-closed while
retaining an ergonomic development workflow.

## Users and User Stories

### US-001 — Mixed-adoption developer

As a developer using agentic tooling on a conventional team, I want rich
planning and review metadata kept in my development repository so that the team
receives a normal, clean pull request without adopting Shipyard.

Acceptance: AC-001 through AC-017 and AC-019 through AC-023.

### US-002 — AI-native repository owner

As the owner of a repository that permits selected agentic records, I want a
single-repository profile so that Shipyard can certify my existing pull request
without creating a redundant destination PR.

Acceptance: AC-001 through AC-010, AC-014 through AC-016, AC-018 through AC-023.

### US-003 — Destination reviewer

As a team reviewer, I want a destination-owned PR containing only approved
product cargo plus a concise review dossier so that I can use the team's normal
review and merge policy without access to the development repository.

Acceptance: AC-011 through AC-017.

### US-004 — Agentic implementer and reviewer

As a Codex worker, I want a small role-specific context envelope pinned to the
current product and ledger SHAs so that I receive necessary context without
cross-contaminating implementation and independent-review sessions.

Acceptance: AC-008 through AC-010 and AC-014 through AC-015.

### US-005 — Multi-account workstation owner

As a user with several GitHub accounts, I want every repository binding to name
its authorized actor and every mutation to use that actor without changing the
machine-wide active account.

Acceptance: AC-001, AC-003, AC-004, and AC-007.

## Functional Requirements

### FR-001 — Product/config separation

The reusable Shipyard engine, public skills, schemas, tests, and progressive
documentation live in the Shipyard package. Private profiles, repository
allowlists, owner/actor policy, and context overlays live in a separate
`shipyard-config` package. Credentials, bindings, locks, worktree registrations,
and rebuildable caches remain machine-local and uncommitted.

### FR-002 — Setup and repository binding

`shipyard-setup` SHALL bind a complete `staged-pair` or `single-repository`
topology to a named global profile. A binding SHALL be keyed by Git's shared
common directory so linked worktrees resolve the same repository identity.
Setup SHALL validate existing repositories and remotes but SHALL NOT provision
repositories, rewrite remotes, or replace a binding without explicit
`--rebind` intent.

Every operational command SHALL stop with actionable `shipyard-setup` guidance
when binding, topology, actor, path policy, dependency, or repository identity
cannot be resolved exactly.

### FR-003 — Public command surface

V1 SHALL expose:

- `shipyard`
- `shipyard-setup`
- `shipyard-status`
- `shipyard-review`
- `shipyard-sync`
- `shipyard-promote`
- `shipyard-finalize`
- `shipyard-help`

Commands SHALL load progressive documentation only for the operation being
performed. Mutation commands SHALL use short per-repository locks; read-only
status/help commands SHALL NOT acquire mutation locks.

### FR-004 — Profile-scoped authority

Each binding SHALL name a GitHub actor independently from repository ownership.
Before a GitHub mutation, Shipyard SHALL resolve the configured credential,
verify the API login equals the actor, and apply repository/operation
allowlists. It SHALL NOT switch the global active GitHub CLI account.

Each authenticated Git command SHALL disable inherited credential helpers and
use an ephemeral scoped credential. Tokens SHALL NOT appear in command
arguments, remotes, logs, ledgers, or error messages.

### FR-005 — Work classification and planning

The `shipyard` orchestrator SHALL classify a request as large, small, bug, or
review-only and record the selected lane.

- Large, foggy work uses Wayfinder, then a CCPM PRD and vertical tasks.
- Small, settled work uses `grill-with-docs`, then `to-spec`; `to-tickets` is
  used only when independent vertical slices add value.
- Bugs begin with `diagnosing-bugs`; disputed behavior or conflicting product
  requirements route to grilling/Wayfinder before implementation.
- Review-only work begins from an exact requested PR/head SHA and cannot mutate
  implementation state unless explicitly converted into a delivery.

CCPM may structure plans and execution, but it SHALL NOT choose GitHub actors,
write outside Shipyard's allowlist, merge, determine metadata ownership, or
declare acceptance complete.

### FR-006 — Dependency verification

Setup and status SHALL verify a machine-readable capability manifest for the
reviewed Matt-skills bundle, maintained CCPM skill-layout fork, Codex adapter,
and any enabled graph adapter. Checks SHALL cover source pin, content receipt,
required files/frontmatter, host discovery, duplicates, runtime capabilities,
and tested adapter combination.

Missing, modified, duplicated, or incompatible dependencies SHALL block with a
specific remediation. Untested newer versions SHALL report `unverified` and
SHALL NOT be upgraded automatically.

### FR-007 — Delivery workspace

A delivery SHALL receive a stable delivery ID, a feature branch in a linked
worktree, and an entry on the parallel `shipyard-ledger` branch. Product work
SHALL NOT occur directly on authoritative `main`.

The ledger branch SHALL be outside product ancestry and SHALL checkpoint PRDs,
specs, decisions, acceptance evidence, review findings/resolutions, test
evidence, context snapshots, and promotion/finalization manifests. It SHALL
never be copied to a staged-pair destination.

### FR-008 — Metadata ownership and sanitization

Every relevant path SHALL resolve to exactly one behavior: product,
development-record, development-generated, destination-only, context-overlay,
or scratch. Unclassified paths or conflicting ownership SHALL block sync,
promotion, and finalization.

`development-only` SHALL keep Shipyard records in the development ledger and
machine-local caches. `shared` SHALL permit only explicitly allowed durable
records and SHALL NOT publish them automatically. Secrets, locks, scratch data,
and rebuildable caches SHALL be prohibited in every destination payload.

Payload construction and comparison SHALL use Git-native trees/indexes so
binary files, executable bits, symlinks, renames, deletions, and unusual paths
are preserved exactly.

### FR-009 — Context envelopes

Every Shipyard-aware worker SHALL receive an explicit envelope containing
profile, topology, repository, delivery ID, host, role, product branch/SHA,
ledger ref/SHA, and exact role-allowed record paths. The minimum adapter call is
`{host, role, envelopePath, repoRoot}`.

The worker SHALL validate the current product SHA before loading any ledger
record. Implementers SHALL receive the contract and assigned task; independent
reviewers SHALL receive intent, acceptance evidence, and review state without
implementation-only chatter; status/sync SHALL load no delivery records.

### FR-010 — Development issue and PR

For GitHub-backed deliveries, the issue and development PR SHALL be created only
in the configured development repository. The development PR is the workspace
for repeated agentic review and revision. It SHALL NOT be merged in a
`staged-pair` delivery.

### FR-011 — Acceptance evidence

Every acceptance criterion and Definition of Done item SHALL have a stable ID,
state (`pass`, `blocked`, or justified `not-applicable`), exact product SHA,
evidence reference, verifier identity, and verification time. Any product-SHA
change SHALL invalidate prior acceptance/review approval until renewed evidence
names the new SHA.

Generated task completion, checked boxes without evidence, and GitHub approval
state SHALL NOT substitute for Shipyard acceptance evidence.

### FR-012 — Independent Codex review

V1 SHALL run review in a separate ephemeral Codex process/session from the
implementer. Review SHALL attest an exact SHA, record findings and validation
evidence, and remain blocked while accepted findings are unresolved. Follow-up
changes SHALL repeat acceptance and independent review.

### FR-013 — Synchronization

Default `shipyard-sync` SHALL require clean, non-divergent baselines and
fast-forward development `main` to the configured authoritative destination
`main`. It SHALL NOT rebase feature work, resolve conflicts, promote, merge, or
finalize.

When explicitly given a branch/tag/ref, sync MAY fetch it into a local
`refs/shipyard/source/...` namespace with recorded provenance. Source refs SHALL
be excluded from Shipyard push refspecs and treated as read-only policy objects;
their remote/name/SHA SHALL be revalidated before use.

### FR-014 — Staged-pair promotion

`shipyard-promote` SHALL require current destination `main`, a reviewed exact
development SHA, complete acceptance evidence, a clean binding, and an allowed
path classification.

It SHALL build an initial sanitized product commit on a destination-owned
branch and create a normal pull request inside the destination repository. It
SHALL NOT create a fork PR, expose a development repository, retain a writable
destination remote in the development clone, or force-push an active
destination PR.

### FR-015 — Destination revision loop

Destination-requested changes SHALL be implemented only on the development
branch, accepted and independently reviewed at a new SHA, then appended to the
existing destination branch as one sanitized product-delta commit. The
promotion manifest SHALL map each reviewed development SHA to its destination
commit and verify tree equivalence.

### FR-016 — Single-repository certification

For a `single-repository` binding, promotion SHALL verify that the existing PR
head equals the accepted/reviewed SHA, contains no prohibited metadata, and has
the review dossier. It SHALL mark that PR ready without creating a second PR or
merging it.

### FR-017 — Human merge and finalization

Shipyard SHALL treat destination merge as an externally performed human/team
action. It SHALL verify the merged PR and expected final head before
finalization.

Finalization SHALL checkpoint the final ledger record, publish an annotated
development-only tag pointing to the reviewed product SHA, synchronize merged
destination `main` exactly to development `main`, close the development PR
without merge for staged pairs, close the development issue, and delete delivery
branches. Each step SHALL be idempotent or resumable after exact-state
revalidation.

### FR-018 — Status and recovery

`shipyard-status` SHALL report binding/profile, topology, actor, dependency
state, delivery phase, product/ledger/destination SHAs, acceptance freshness,
PR states, locks, graph freshness, blockers, and the next safe command.

Interrupted mutations SHALL leave a checkpoint sufficient to distinguish
completed, pending, conflicting, and unsafe-to-repeat steps. Stale-lock recovery
SHALL validate process/host ownership before removal.

### FR-019 — Graph freshness

The core SHALL define a tool-independent graph contract keyed by exact source
commit plus working-tree fingerprint. A baseline graph MAY seed an independent
per-worktree cache; divergent worktrees SHALL never share mutable state. Stale,
unavailable, or failed graphs SHALL be surfaced and SHALL fall back to direct
source inspection.

Graphify and CodeGraph MAY be enabled through explicit experimental profile
flags. Understand Anything SHALL NOT be authoritative for feature-worktree
state in v1.

### FR-020 — Progressive documentation

Each public skill SHALL link to focused Markdown references for topology,
metadata ownership, ledger/context, credentials, synchronization, promotion,
review, finalization, and recovery. Agents SHALL not need to load the entire
Shipyard operating model for a narrow command.

## Non-Functional Requirements

### NFR-001 — Fail-closed safety

No ambiguous binding, actor, path, SHA, dependency, ref provenance, or lifecycle
state may fall back to a guess. Mutation SHALL stop before the first external
write.

### NFR-002 — Security and privacy

Secrets SHALL remain in approved credential stores or ephemeral process
environments. Logs and durable records SHALL be safe to inspect. Proprietary
source SHALL not be sent to an external graph/model provider without an
explicitly reviewed profile policy.

### NFR-003 — Determinism and traceability

Every promotion/finalization decision SHALL be reconstructable from immutable
Git SHAs, ledger records, manifests, and provider URLs. Re-running status on the
same state SHALL produce the same safety decision.

### NFR-004 — Portability

The generic engine SHALL not contain owner-specific repository names or private
policy. Host/provider behavior SHALL live behind narrow adapters.

### NFR-005 — Performance

Read-only status SHALL complete without loading delivery documents or building
graphs. Worktree graph seeds SHALL avoid full rebuilds when an exact compatible
baseline exists, but correctness SHALL take precedence over cache reuse.

### NFR-006 — Maintainability

Third-party dependencies SHALL remain external, attributed, exact-pinned, and
upgradeable only through reviewed compatibility changes. V1 SHALL not maintain
a casual vendor copy.

### NFR-007 — Testability

Core state transitions and guards SHALL be executable against disposable local
Git repositories. Provider adapters SHALL support opt-in private synthetic
fixture tests with no production repository dependency.

## Acceptance Criteria

- **AC-001 Setup fails closed:** Unbound, partially bound, stale, duplicate, or
  remote-mismatched repositories receive actionable setup/rebind errors before
  mutation.
- **AC-002 Worktree identity:** A linked worktree resolves the same binding as
  its main clone through the shared Git common directory.
- **AC-003 Scoped GitHub actor:** A command configured for actor A verifies A,
  completes without switching the globally active `gh` account, and rejects an
  unexpected login before mutation.
- **AC-004 Scoped Git transport:** Authenticated Git ignores inherited
  credential helpers, succeeds with the configured ephemeral actor, and never
  persists or prints its token.
- **AC-005 Clean main sync:** A clean, non-divergent development `main`
  fast-forwards to exactly the authoritative destination `main`; dirty or
  divergent baselines block.
- **AC-006 Named source sync:** Only an explicitly named destination ref is
  imported into `refs/shipyard/source/...`; provenance/SHA changes and attempted
  publication block.
- **AC-007 Issue targeting:** GitHub issue writes occur only in the configured
  development repository; the destination receives no Shipyard workflow issue.
- **AC-008 Ledger isolation:** `shipyard-ledger` is outside product ancestry,
  survives feature cleanup, and is absent from a staged-pair destination.
- **AC-009 Role context:** Implementer, reviewer, and status envelopes load only
  their allowed record sets.
- **AC-010 Stale context:** A product-SHA mismatch stops before the first ledger
  record load.
- **AC-011 Normal destination PR:** Staged promotion creates a destination-owned,
  non-cross-repository PR whose initial product tree equals the reviewed
  development tree.
- **AC-012 Append-only revision:** Destination feedback produces a newly
  accepted/reviewed development SHA and one descendant destination commit; no
  active destination branch is force-pushed.
- **AC-013 Metadata containment:** Prohibited records/caches/overlays cannot
  enter the destination payload; Git-native tree comparison covers all file
  modes and path operations.
- **AC-014 Evidence closure:** Every acceptance and Definition of Done ID has
  exact-SHA, verifier, time, state, and evidence; incomplete or stale items block
  promotion/finalization.
- **AC-015 Independent review:** Reviewer execution is separate from the
  implementer, attests the current exact SHA, and cannot load
  implementation-only context.
- **AC-016 Human merge boundary:** Shipyard cannot mark delivery complete before
  a verified destination merge of the expected head.
- **AC-017 Staged finalization:** After merge, development/destination mains are
  exact, the development PR is closed without merge, the issue is closed,
  delivery branches are deleted, and the reviewed tag/ledger remain
  development-only.
- **AC-018 Single-repository flow:** Certification updates only the existing PR,
  verifies its exact head and metadata policy, and never creates or merges a
  second PR.
- **AC-019 Resumability:** Failure after any external mutation can resume without
  duplicating issues/PRs/commits/tags or skipping exact-state validation.
- **AC-020 Dependency contract:** Exact tested dependencies pass; missing,
  locally modified, duplicated, incompatible, or unverified versions produce
  distinct actionable states without automatic upgrade.
- **AC-021 Mutation locking:** Concurrent mutations for the same bound repository
  cannot proceed; stale recovery validates owner process/host.
- **AC-022 Graph safety:** Experimental graph adapters isolate divergent
  worktrees, detect commit and dirty-tree changes across sessions, and fall back
  safely when stale or unavailable.
- **AC-023 Progressive operation:** Each public skill can complete its narrow
  job from its focused reference set and returns the next safe command/status.

## Definition of Done

- **DOD-001:** All eight public skills, schemas, focused references, and help
  examples are implemented for Codex discovery.
- **DOD-002:** Unit tests cover schemas, binding resolution, actor/path policy,
  envelope construction, evidence invalidation, state transitions, and recovery
  decisions.
- **DOD-003:** Disposable local Git integration tests cover both topologies,
  dirty/divergent baselines, source refs, ledger/tag retention, append-only
  revision, sanitization, and resumable cleanup.
- **DOD-004:** An opt-in private synthetic GitHub fixture run proves issue
  targeting, command-scoped credentials, normal destination-owned PRs,
  exact-head merge verification, close-without-merge behavior, and zero metadata
  leakage.
- **DOD-005:** Independent ephemeral Codex implementation/review probes prove
  role-limited context and stale-envelope rejection.
- **DOD-006:** Every AC-001 through AC-023 is recorded as pass or justified
  not-applicable against the exact release-candidate SHA with evidence links;
  no blocked, unchecked, or stale criterion remains.
- **DOD-007:** Security tests prove tokens are absent from remotes, argv, logs,
  error messages, ledgers, and destination content.
- **DOD-008:** Dependency manifest, content receipts, licenses/attribution, and
  tested host/runtime matrix are present and verified by setup/status.
- **DOD-009:** Setup, staged-pair, single-repository, sync, review, promote,
  finalize, interruption recovery, and troubleshooting runbooks are complete.
- **DOD-010:** Independent code review of the exact release-candidate SHA has no
  unresolved accepted findings.
- **DOD-011:** Deferred hosts/integrations are clearly labeled unsupported or
  experimental and are not implied by public examples.
- **DOD-012:** The predecessor workflow remains untouched until a separate,
  reversible migration and compatibility-alias plan is approved.

## Success Criteria

- 100% of mutation entry points validate binding, actor, policy, dependency,
  exact SHA, and lifecycle state before their first external write.
- 100% of staged destination payloads contain only explicitly classified cargo.
- 0 global GitHub account switches and 0 persisted destination credentials or
  writable destination remotes in staged development clones.
- 0 acceptance/review approvals remain valid after a product-SHA change without
  renewed evidence.
- Both topologies complete their automated local lifecycle suites; the staged
  GitHub fixture suite completes without a fork PR or force push.
- Every interrupted external-mutation checkpoint has a deterministic resume or
  explicit manual-recovery state.
- A new user can bind an existing eligible repository and identify the next
  safe delivery action using setup/status documentation without reading the
  full internal design.

## Constraints and Assumptions

- V1 runs on macOS with Git, GitHub CLI, Node, and Codex available; exact runtime
  requirements are recorded in the dependency manifest.
- Repositories already exist. Setup does not create them or rewrite their
  remotes.
- The configured actor already has the provider permissions required by the
  selected topology.
- Destination branch protection and human approval policy belong to the
  destination team. Shipyard verifies observed results but does not weaken or
  replace that policy.
- Codex is the only supported live host in v1. The adapter interface must remain
  host-neutral so later hosts do not require workflow-policy forks.
- GitHub is the only v1 remote tracker/PR provider. Local Markdown remains valid
  for pre-implementation Wayfinder planning and durable ledger records.
- `single-repository` is required v1 scope and must gain dedicated acceptance
  coverage during implementation before release.
- Experimental graph adapters may be unavailable without blocking source-based
  development.

## Out of Scope

- Claude Code/CCPM and Cursor/Pstack live execution guarantees.
- Implicit child-agent context inheritance.
- Multiple concurrent profile actors or automatic account switching.
- Non-GitHub trackers such as GitLab, Linear, Jira, or generic Markdown issue
  synchronization.
- Production repository provisioning, mirror creation, remote rewriting, or
  automatic organization onboarding.
- Any Just Games repository, credential, profile migration, or predecessor
  skill retirement.
- Official GitHub approval-dismissal semantics and exhaustive protected-branch
  policy variants.
- Automatic merging of destination PRs.
- Authoritative Understand Anything feature-worktree graphs.
- Public release, repository extraction, license choice for Shipyard-owned
  predecessor code, or marketplace/plugin packaging.
- `shipyard-ledger-understand`.
- Completion of the separately deferred detailed bug-policy workflow.

## Dependencies

- Matt Pocock engineering-skill bundle at reviewed commit
  `2ab958093e83e0ec752e6c1c5932da465bf23e0c`, consumed through the existing
  maintenance receipt rather than vendored.
- Maintained `visualjc/ccpm` skill-layout fork at reviewed commit
  `cdb97474904ab2cdc7d391aa17393b444a28be3e`.
- Codex host adapter proven with Codex CLI `0.144.4` during the Wayfinder
  prototype.
- Git and GitHub CLI with REST API access for the configured actor.
- Node runtime for Shipyard scripts; experimental CodeGraph requires a runtime
  whose SQLite build passes the FTS5 probe (Node `24.13.1` passed the prototype).
- Optional experimental Graphify and CodeGraph adapters at separately recorded
  reviewed pins.
- Private profile/config package for real repository bindings and policy.

## Planning Evidence

- Product premise: [`../../../../PREMISE.md`](../../../../PREMISE.md)
- Completed Wayfinder map: [`../../map.md`](../../map.md)
- Local lifecycle findings:
  [`../../prototypes/local-lifecycle/findings.md`](../../prototypes/local-lifecycle/findings.md)
- Ledger/context findings:
  [`../../prototypes/ledger-context/findings.md`](../../prototypes/ledger-context/findings.md)
- Graph freshness findings:
  [`../../prototypes/worktree-graph-freshness/findings.md`](../../prototypes/worktree-graph-freshness/findings.md)
- Codex context-handoff findings:
  [`../../prototypes/host-context-handoff/findings.md`](../../prototypes/host-context-handoff/findings.md)
- GitHub lifecycle findings:
  [`../../prototypes/github-pr-lifecycle/findings.md`](../../prototypes/github-pr-lifecycle/findings.md)
- Final v1 boundary:
  [`../../issues/19-select-the-evidence-backed-v1-boundary.md`](../../issues/19-select-the-evidence-backed-v1-boundary.md)
