# Slipway

Slipway coordinates planned software delivery across a private agentic repository and a clean team-facing delivery repository.

## Products

**Slipway**:
The skills-first, agent-directed workflow coordinator described by this context.
_Avoid_: Shipyard Lite, skills-first Shipyard

**Shipyard**:
The separate policy-engine product that provides stronger runtime enforcement.
_Avoid_: Legacy Shipyard, Shipyard engine legacy

## Repository Pair

**Agentic repository**:
The private repository where agents plan, implement, test, and review work.
_Avoid_: Personal repository, source repository

**Delivery repository**:
The clean, non-agentic repository whose pull request is reviewed and merged by the normal team.
_Avoid_: Company repository, destination repository

**Agentic main**:
The clean baseline in the agentic repository whose product history exactly follows delivery main.
_Avoid_: Development main, integration main

**Work branch**:
A uniquely named agentic branch on which one Slipway run performs product work.
_Avoid_: Run branch, feature workspace

**Delivery PR**:
The team-facing pull request containing only reviewed product cargo.
_Avoid_: Company PR, promotion PR

## Workflow

**Run**:
One planned or active delivery effort, identified by its complete work-branch name.
_Avoid_: Job, session, delivery ID

**Run shard**:
The run-owned durable record used to pause, resume, and coordinate that run independently of other runs.
_Avoid_: Run folder, project store

**Ledger branch**:
The parallel branch that owns Slipway durable state and never enters product ancestry.
_Avoid_: State branch, metadata branch

**Private agent overlay**:
Project-wide agent policy owned by the ledger and materialized only as ignored files in an agentic worktree.
_Avoid_: Metadata branch, private commit, agentic base branch

**Overlay tree ID**:
The Git tree object ID of the canonical ledger overlay directory; the stable content version used to detect missing or stale hydration without reacting to unrelated ledger commits.
_Avoid_: Ledger SHA, policy commit

**Public extension contract**:
The skill-agnostic tracked instruction that optionally loads local-only policy, plus a host adapter such as `CLAUDE.md` importing `AGENTS.md`.
_Avoid_: Matt configuration, Repo-B policy

**Hydration**:
The fail-closed act of validating and materializing the canonical private overlay into one exact agentic worktree, then recording and byte-verifying its overlay tree ID.
_Avoid_: Checkout, overlay merge

**Cargo commit**:
An exact, reviewed agentic commit containing only product changes eligible for the delivery repository.
_Avoid_: Promotion commit, sanitized commit

**Build provider**:
The installed skill system selected to execute implementation tickets; Matt skills are the baseline and pstack is an explicit enhancement.
_Avoid_: Execution engine, policy provider

**Finalization**:
The terminal reconciliation after human delivery merge, agentic-main synchronization, and closure of the agentic PR without merge.
_Avoid_: Merge, cleanup

## Work Lanes

**Tiny change**:
A settled, single-product-commit change that may bypass formal specification only after Slipway explains the classification and the user permits it.
_Avoid_: Trivial change, quick fix

**Small development**:
A bounded effort that needs grilling, a specification, tickets, implementation, and a delivery gate.
_Avoid_: Tiny change

**Large development**:
A multi-session effort with unresolved product or architecture decisions that begins with Wayfinder before specification and ticket execution.
_Avoid_: Epic, CCPM lane
