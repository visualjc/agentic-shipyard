---
issue: 9
title: Integrate planning lanes and public orchestration
analyzed: 2026-08-04T00:00:00Z
product_head_inspected: 3fd4858fbb007233cc93ad6fb93282d55fa11cad
depends_on: [2, 3, 4, 5, 6, 7, 8]
status: planned-blocked-on-accepted-issue-6-and-topology-operations
estimated_hours: 32-44
parallelization_factor: 1.25
---

# Parallel Work Analysis: Issue #9

## Scope, decision record, and blocking frontier

This is the plan for Shipyard's opinionated planning/orchestration surface. It
does not implement a command, install or upgrade a dependency, mutate GitHub,
invoke a remote Git transport, run a live fixture, or authorize a product
write. The inspected product baseline is exact commit
`3fd4858fbb007233cc93ad6fb93282d55fa11cad`, the accepted deterministic Issue
#5 synchronization result. Issues #2, #3, #4, and #5 supply the current
binding/status/help, ledger/envelope, scoped development-tracker, and narrow
sync boundaries. Issue #4's live-fixture gate remains unapproved; its empty
allowlist is not softened by this task.

The Wayfinder toolchain decision and the PRD settle the intended lane policy:

| Class | Required planning sequence | Delivery boundary |
| --- | --- | --- |
| `large` / foggy | `wayfinder` -> CCPM PRD -> vertical CCPM tasks | Shipyard owns binding, actor, path/metadata, evidence, review, promotion, and finalization. |
| `small` / settled | `grill-with-docs` -> `to-spec` -> optional `to-tickets` only for independent vertical slices | Use the same Shipyard delivery/evidence gates; do not inflate a settled change into a CCPM PRD. |
| `bug` | `diagnosing-bugs`; disputed behavior or conflicting requirements -> grilling / Wayfinder before any implementation | A proven regression may proceed through the appropriate settled/large delivery lane; a requirement conflict is not silently classified as a code fix. |
| `review-only` | exact requested PR/head SHA -> scoped review | No implementation mutation unless the user explicitly converts it to a delivery and Shipyard creates a new governed record. |

This routing is a recorded, explainable decision, never an inference that
authorizes a tracker write. CCPM may synthesize a PRD, decompose vertical
tasks, and coordinate the default Codex multi-agent implementation/review
workflow; it cannot select a GitHub identity, write an issue or PR outside
Shipyard's bound allowlist, choose metadata ownership, merge, finalize, or
turn checked boxes into acceptance. Matt skills provide focused discussion and
artifact work; they do not receive a raw provider, ledger, profile, token, or
promotion capability.

No mergeable implementation stream begins until all of the following exist at
one accepted integrated product SHA:

1. Issue #6's non-forgeable current-SHA acceptance/review operation, including
   complete finding/resolution history, renewed-review semantics, and
   role-limited Codex envelopes.
2. Issue #7's staged-pair operation API and Issue #8's single-repository
   operation API, with their canonical delivery/checkpoint/status handoffs.
3. The settled public capability inventory from those operations. This issue
   must dispatch typed authority-created operations, not reconstruct them from
   CLI arguments, a PRD, a task checkbox, a raw ledger record, or a status
   projection.

Until that frontier clears, analysis/test scaffolding may use deterministic
fakes and disposable local repositories only. It must not create/update/close
an issue or PR, push/fetch from an authenticated live remote, alter `gh`
configuration, use `NativeInteractive`, install/update Matt skills or CCPM,
or touch any Just Games resource.

## Fixed dependency and host contract

Shipyard consumes rather than vendors its external systems. The required
tested receipts are exact pins, not ranges:

| Dependency | Tested receipt | Required use in v1 |
| --- | --- | --- |
| Matt Pocock engineering-skill bundle | `mattpocock/skills@2ab958093e83e0ec752e6c1c5932da465bf23e0c` | Full reviewed 20-skill distribution installed by the existing maintenance receipt; lanes load only their focused subset. |
| Maintained CCPM skill-layout fork | `visualjc/ccpm@cdb97474904ab2cdc7d391aa17393b444a28be3e` | One current `ccpm` Agent Skill interface for PRD/task synthesis and Codex-host execution. Legacy `/pm:*` is migration guidance, never a guessed compatibility path. |
| Codex host adapter | Codex CLI `0.144.4` | The sole supported live v1 host; implementation and independent review use separate ephemeral processes and Issue #6 envelopes. |

Cursor/Pstack (`0.14.0` at `fa16d695b35ccf4ea179d976e5aaee0834a25b0b`) is
not a v1 live adapter, and neither Claude Code/CCPM nor Cursor/Pstack may be
advertised as operational in command examples. Their future compatibility
must remain labeled deferred/unsupported. The manifest may describe them as
known migration or future lanes but status must not treat their presence as a
pass for a Codex v1 delivery.

`shipyard-setup` and `shipyard-status` consume a machine-readable Shipyard
capability manifest and independently observed installation receipt. For each
dependency needed by the selected lane/host, verification distinguishes:

- `ready`: exact source pin, content receipt, required `SKILL.md` frontmatter
  and required supporting files, one canonical discovery definition, tested
  host/runtime combination, and required invocation metadata all match;
- `missing`, `modified`, `duplicate`, or `incompatible`: a blocking condition
  with a specific non-mutating remediation;
- `unverified`: a recognizable newer/different source that is neither silently
  accepted nor auto-upgraded; and
- `not-required`: a feature/lane not selected, reported without widening the
  active host contract.

The verifier reads source/version receipts separately from capability
authority. A receipt, a `SKILL.md`, an environment value, a filesystem path,
or a caller-provided manifest can never grant issue, PR, merge, Git, profile,
or ledger-write authority. The existing Matt maintenance package remains the
only installation authority; Shipyard never makes a second `vendor/` copy or
repairs a dependency as part of setup/status.

## Target public contract

The eight public Agent Skills and matching CLI surface are intentionally thin:
`shipyard`, `shipyard-setup`, `shipyard-status`, `shipyard-review`,
`shipyard-sync`, `shipyard-promote`, `shipyard-finalize`, and `shipyard-help`.
Each has a directory with `SKILL.md`, `agents/openai.yaml`, and only the
operation-specific references it needs. It calls one command service; skills
may explain and route but may not restate policy or execute raw GitHub/CCPM
instructions. Help/status are read-only and acquire no mutation lock.

The proposed authority-created facade is deliberately narrow:

```text
ShipyardOrchestrator.start({ requestText, repositoryPath })
  -> LaneStatus { classification, recordId, prerequisiteState, nextSafeCommand }

ShipyardOrchestrator.resume({ deliveryId })
  -> DeliveryStatus

DependencyVerifier.inspect({ repositoryPath, selectedHost, selectedLane })
  -> DependencyStatus
```

The facade derives the binding, profile fingerprint, configured actor,
topology, current product/ledger facts, manifest location, and operation
allowlist internally. It accepts neither an actor/token, raw issue/PR URL,
provider client, destination target, ledger head/body, review decision,
evidence result, product SHA, classified paths, dependency pass result, nor a
generic arbitrary command. A `LaneStatus` is a detached serializable snapshot:
safe IDs, phase, named dependency states, sanitized blockers, and the one next
safe command. It has no authority methods.

For any mutation path the facade must first select the bounded existing
operation from a verified profile, then that operation revalidates the binding,
actor, topology, policy, dependency gate, exact state, and common-directory
lock immediately before its first external write. Command-scoped `visualjc`
is the only supported actor for configured v1 profiles; there is no global
account switch, ambient-credential fallback, account selection UI, or
multi-account routing. Setup must stop when a profile/binding has not made
that actor exact. No public command may create a `NativeInteractive` record or
write to an unapproved live fixture.

## Stream plan and file ownership

### Stream A — Dependency manifest, receipt verifier, and lane decision domain

**Scope.** Own the pure schemas/validators for capability manifests, external
source/content receipts, host discovery observations, dependency state,
classification decision, lane record, and safe next-action selection. It
contains no process execution, filesystem traversal, GitHub call, Git call,
lock, ledger write, or CLI parsing.

**Exclusive files.**

- `src/orchestration/types.ts`
- `src/orchestration/errors.ts`
- `src/orchestration/classification.ts`
- `src/dependencies/types.ts`
- `src/dependencies/schema.ts`
- `src/dependencies/verification.ts`
- `config/capabilities.v1.json`
- `test/orchestration/classification.test.ts`
- `test/dependencies/schema.test.ts`
- `test/dependencies/verification.test.ts`

**Publishes.** Branded/validated `Lane`, `LaneDecision`, `DependencyState`,
`CapabilityManifest`, `ObservedDependencyReceipt`, `DependencyStatus`, and
the immutable `LaneRecord` shape. Lane classification requires explicit
recorded reasons/evidence; ambiguous or conflicting signals yield
`needs-grilling`/`needs-wayfinding`, not a guessed delivery path.

**Verification.** Table and hostile-input tests cover each lane, bad bug
classification, requirement conflicts, review-only no-mutation default,
unknown keys/accessors/proxies, source/content drift, missing assets,
malformed frontmatter/invocation metadata, canonical/discovery duplicates,
legacy CCPM, modified Matt content, newer untested versions, wrong Codex
version, and a receipt or path attempting to forge readiness. The test suite
proves no mutation/process port is imported by this domain.

### Stream B — Read-only installation/discovery probes and setup/status integration

**Scope.** Implement injected, bounded local probes for the manifest/receipt,
skill tree, host discovery, and runtime capability observations. Compose their
results into `shipyard-setup` and `shipyard-status` without installing,
updating, deleting, or relinking a dependency. Setup validates; status merely
observes. Both return explicit remediation and next-safe commands.

**Exclusive files.**

- `src/adapters/dependency-filesystem.ts`
- `src/adapters/dependency-runtime.ts`
- `src/dependencies/observer.ts`
- `src/dependencies/service.ts`
- `src/commands/dependency-status.ts`
- `docs/dependencies.md`
- `docs/unsupported-hosts.md`
- `test/dependencies/observer.test.ts`
- `test/dependencies/service.test.ts`
- `test/integration/dependency-status.test.ts`

**Consumes.** Stream A's pure contract and the accepted Issue #2 read-only
command/status seams. It reads, but does not edit, existing binding/profile
authority. It cannot acquire a mutation lock, invoke `gh`, invoke Git,
create a child agent, make a network request, or load delivery records.

**Verification.** Disposable temp trees and fake runtime probes demonstrate
canonical `~/.agents/skills` discovery, expected host links where applicable,
duplicate detection, content receipts, support assets such as
`agents/openai.yaml`, fail-closed wrong/missing runtime, exact/unverified
states, no automatic repair, and read-only adapter-call traces. Tests assert
that setup/status never alter `.agents`, `.claude`, Cursor, profiles, global
GitHub configuration, or a repository remote.

### Stream C — Codex-only orchestrator and governed planning handoff

**Scope.** Build the authority-created command service that takes a user
request, resolves the selected lane after verified setup/dependencies, stores
a private/development-only planning checkpoint through the existing ledger
authority, and calls a small Codex-host planning adapter. For large work it
requests Wayfinder then a CCPM PRD and vertical tasks; for small work it
requests grill-with-docs then to-spec; bugs begin with diagnosing-bugs and
escalate disputed behavior; review-only requests create only a scoped review
intent. It dispatches Issue #6/#7/#8 typed operations once available, never
raw CCPM commands or provider APIs.

**Exclusive files.**

- `src/orchestration/authority.ts`
- `src/orchestration/service.ts`
- `src/orchestration/ledger.ts`
- `src/orchestration/status.ts`
- `src/adapters/codex-planning.ts`
- `src/adapters/ccpm-planning.ts`
- `src/adapters/matt-skills.ts`
- `test/orchestration/service.test.ts`
- `test/orchestration/ledger.test.ts`
- `test/adapters/codex-planning.test.ts`
- `test/integration/orchestration/**`

**Can start.** API-only tests can start after Stream A. Any integration or
mergeable operation wiring waits for accepted integrated Issue #6 and the
implemented Issue #7/#8 typed handoffs. It must not invent temporary
promotion/finalization/evidence substitutes to unblock itself.

**Verification.** Fakes capture only role-minimal envelopes. Tests prove the
implementer, planner, and reviewer receive distinct exact pinned envelopes;
stale product/ledger facts reject before dispatch; a planner cannot select a
different actor/repository/topology or perform issue/PR/merge/promotion work;
CCPM generated completion cannot satisfy evidence; and review-only cannot
modify implementation. The fake adapter must be unable to run arbitrary shell
text or inherit a provider/token/ledger-write capability. Planning records are
append-only/CAS through the #3 ledger boundary, reject malicious PRD/task
paths and metadata ownership conflicts, and never enter product cargo.

### Stream D — Eight command skills, focused references, and serialized public handoff

**Scope.** After A-C and the topology operation inventory settle, wire all
eight CLI commands, bin entries, Codex Agent Skills, `openai.yaml` metadata,
focused references, help text, package discovery, and the one public-export
handoff. The skills route to the common services; none embeds an alternative
workflow or grants broader authority.

**Exclusive files.**

- `src/commands/orchestrate.ts`
- `src/commands/review.ts`
- `src/commands/promote.ts`
- `src/commands/finalize.ts`
- `src/cli/orchestrate.ts`
- `src/cli/review.ts`
- `src/cli/promote.ts`
- `src/cli/finalize.ts`
- `bin/shipyard`, `bin/shipyard-review`, `bin/shipyard-promote`, `bin/shipyard-finalize`
- `skills/shipyard/**`, `skills/shipyard-setup/**`, `skills/shipyard-status/**`
- `skills/shipyard-review/**`, `skills/shipyard-sync/**`, `skills/shipyard-promote/**`
- `skills/shipyard-finalize/**`, `skills/shipyard-help/**`
- `docs/planning-lanes.md`, `docs/review.md`, `docs/promotion.md`, `docs/finalization.md`
- `test/cli/orchestration.test.ts`
- `test/integration/skills/**`

**Serialized shared handoff only after all streams pass:** `src/cli/main.ts`,
`src/cli/runtime.ts`, `src/commands/status.ts`, `src/commands/help.ts`,
`src/status/projection.ts`, `src/index.ts`, `README.md`, and `package.json`.
No other stream edits these files. The integrator reconciles exports through
the public owners instead of changing a completed operation's internals.

**Verification.** Installed-package and fixture discovery tests require all
eight `SKILL.md` files, valid frontmatter, required `agents/openai.yaml`, only
focused references, executable command mapping, and no duplicate public skill
definition. Help/reference link smoke tests prove every skill returns a safe
next command without loading the complete operating model. Read-only
status/help traces prove no lock/write. Mutation command matrices prove setup,
manifest, binding, actor, path policy, evidence freshness, topology state, and
lock gate before dispatch. Text snapshots prohibit claims that Claude,
Cursor/Pstack, multi-account routing, a legacy alias, or a raw CCPM command is
supported.

## Adversarial integration matrix

| Scenario | Required outcome | Stream |
| --- | --- | --- |
| Foggy feature is presented as small | Record ambiguity and return Wayfinder/grilling next action; no PRD/task/provider write. | A/C |
| Settled tiny fix | Record small lane and request grill-with-docs -> to-spec; CCPM PRD is not forced. | A/C |
| Bug has incompatible requirements | Escalate to grilling/Wayfinder; no `diagnosing-bugs` finding becomes a code-fix authority. | A/C |
| Review-only URL/head supplied | Bind and re-observe exact head; create review intent only; implementation/promotion APIs inaccessible. | C/D |
| Matt/CCPM pin or content differs | `modified`/`unverified`/`incompatible` with remediation; no auto-update, vendoring, or arbitrary substitute. | A/B |
| Duplicate skill discovered | Block before planning dispatch; status identifies canonical/remediation without deleting anything. | A/B/D |
| Legacy `/pm:*`, Claude, or Cursor/Pstack selected | Explicit unsupported/migration guidance; never fake a Codex-compatible run. | B/D |
| Planner tries actor/repo/issue override | Reject before adapter/provider creation; actor remains profile-derived command-scoped `visualjc`. | C |
| Stale evidence/accepted finding/changed SHA | #6 gate denies dispatch; record only safe renewal action. | C/D |
| Mutable operation after status success | Revalidate all authority and lock facts at operation boundary; status is never a capability. | C/D |
| Hostile manifest/receipt/skill metadata | Validation rejects unknown keys, unsafe paths, accessors, oversized content, and redacts paths/errors. | A/B |
| Packaging/discovery regression | Package test fails if a command/skill/reference/metadata asset is absent or duplicate. | D |

## Completion evidence and handoffs

Issue #9 may claim AC-020 only from exact-pin/content/discovery/runtime
matrices and AC-023 only from installed-package progressive-skill tests at one
exact integrated product SHA. It may not borrow CCPM task state, a raw skill
autocomplete result, GitHub approval, or an earlier operation's evidence. A
fresh independent high-capability Codex reviewer receives the exact integrated
SHA, issue intent, test transcript, package contents, and its reviewer-only
envelope. Any accepted finding requires a current-SHA resolution and renewed
review under Issue #6's authority.

The final ledger evidence must state the purposely unrun live-private fixture,
the empty approved allowlist, and that no NativeInteractive/Just Games/remote
mutation occurred. Its only downstream handoff is the issue #11 release gate:
the final release audit consumes detached dependency/lane/public-command
statuses and exact evidence; it does not accept the orchestrator as a broad
escape hatch.
