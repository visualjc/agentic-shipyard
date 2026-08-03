# Research: Shipyard v1 development-toolchain contract

Status: complete  
Evidence captured: 2026-08-03

## Decision

Shipyard v1 should be an orchestration and policy layer over reviewed external
dependencies, not a redistribution of them. It should name capabilities in its
own workflow contract, pin the exact implementation that was tested, verify the
installation before use, and route every external write through Shipyard's
binding, actor, metadata, and promotion guards.

The supported initial combination is:

- Matt Pocock's engineering skills from `mattpocock/skills` at reviewed commit
  `2ab958093e83e0ec752e6c1c5932da465bf23e0c`, installed by the existing local
  maintenance package rather than copied into Shipyard.
- The `visualjc/ccpm` maintained fork at reviewed commit
  `cdb97474904ab2cdc7d391aa17393b444a28be3e`, using its current single `ccpm`
  Agent Skill interface. CCPM supplies planning, work decomposition, and
  multi-agent execution; Shipyard must intercept its issue-writing and merging
  behavior.
- Cursor's Pstack plugin version `0.14.0`, commit
  `fa16d695b35ccf4ea179d976e5aaee0834a25b0b`, for the Cursor lane only.
- Claude Code, Codex, or Cursor as a host. A host is required, but no single host
  is universally required.

These are tested pins, not compatibility ranges. An untested newer version is
not automatically incompatible, but Shipyard must report it as unverified and
must not silently upgrade it.

## Capability contract

### Universal workflow capabilities

Every reviewed delivery needs implementations for:

1. profile and repository binding;
2. path ownership and payload sanitization;
3. planning or a settled delivery contract;
4. exact-SHA acceptance evidence;
5. independent review and revision;
6. topology-specific promotion;
7. finalization and durable ledger records.

Shipyard owns capabilities 1, 2, 4, 6, and 7. External skills and host adapters
may implement 3 and 5, but they operate under Shipyard authority.

### Required Matt-skill capabilities

The full reviewed 20-skill installation remains the supported distribution
unit, while a particular delivery loads only the relevant skills.

| Stage | Required or situational skills |
| --- | --- |
| Product discovery | `grilling`, `grill-with-docs`, `wayfinder`, `research`, `prototype` |
| Requirements | `domain-modeling`, `to-spec`; `to-tickets` when multiple vertical slices help |
| Bugs | `diagnosing-bugs`, followed by requirements grilling when the behavior is disputed |
| Implementation | `tdd`, `implement`, `code-review`, `resolving-merge-conflicts` |
| Situational support | `ask-matt`, `codebase-design`, `improve-codebase-architecture`, `triage`, `handoff`, `setup-matt-pocock-skills` |

The skills use the standard Agent Skills directory format: a directory with a
`SKILL.md` plus optional scripts, references, and assets. The standard requires
`name` and `description` frontmatter and supports progressive disclosure.
[Agent Skills specification](https://agentskills.io/specification)

The existing manager at
`/Users/jimcarter/projects/computer-management/matt-pocock-skills/` is the
canonical installation authority. It already records the reviewed source,
checks local modifications, and synchronizes the canonical
`~/.agents/skills` tree to supported hosts. Shipyard should consume and verify
that receipt; it should not create a second `vendor/` copy.

### CCPM lane

Current upstream CCPM has moved from the legacy collection of `/pm:*` commands
to a harness-agnostic `ccpm` Agent Skill. The maintained `visualjc/ccpm` fork
retains that interface and adds its own context and testing material.
[CCPM upstream skill](https://github.com/automazeio/ccpm/tree/7d7e4623bc6d4c0c9ba66ca6bfecd7e5261dc697/skill/ccpm)
[Maintained fork skill](https://github.com/visualjc/ccpm/tree/cdb97474904ab2cdc7d391aa17393b444a28be3e/skill/ccpm)

Shipyard may use CCPM to synthesize a PRD, decompose work, coordinate agents,
and track execution. It must not delegate these policies to raw CCPM commands:

- selecting the GitHub actor or deciding which repository may receive issues;
- merging an epic or feature branch into `main`;
- closing the development PR after a destination merge;
- deciding which `.claude/prds` or `.claude/epics` records may enter product
  history; or
- treating generated task completion as acceptance evidence.

The Shipyard adapter therefore exposes a bounded subset of CCPM's capabilities
and relocates or checkpoints CCPM records according to the metadata policy.
Legacy `/pm:*` installations are unsupported by the v1 adapter and should
produce migration guidance, not an attempted compatibility guess.

### Cursor Pstack lane

Pstack is an optional host-specific execution and review engine, required only
when the selected host adapter is Cursor/Pstack. The reviewed plugin manifest
identifies version `0.14.0` and its supplied skills and agents.
[Pstack plugin manifest](https://github.com/cursor/plugins/blob/fa16d695b35ccf4ea179d976e5aaee0834a25b0b/pstack/.cursor-plugin/plugin.json)

Shipyard should detect the plugin ID, reviewed version or commit, and the exact
capabilities its adapter invokes. It should not copy the plugin, install it
globally, or assume every Pstack skill is part of the public Shipyard surface.
The local `pstack-review` skill is a JustGames wrapper and is migration input,
not evidence of a stable Pstack API.

### Host discovery

- Claude Code discovers user skills in `~/.claude/skills` and project skills in
  `.claude/skills`; users can invoke a skill by `/name`, while Claude may also
  select it from its description. [Claude Code skills](https://code.claude.com/docs/en/slash-commands)
- Codex discovers user skills in `~/.agents/skills` and repository skills in
  `.agents/skills`, progressively loading their instructions. Explicit and
  implicit invocation are supported. [Codex customization](https://learn.chatgpt.com/docs/customization/overview)
- Cursor 2.4 introduced Agent Skills in the editor and CLI and exposes them
  through the slash-command menu. [Cursor 2.4 changelog](https://cursor.com/changelog/2-4)

Filesystem discovery is necessary but not sufficient. Ticket 15 must prove
that each host passes the same pinned Shipyard context envelope to its actual
worker and reviewer boundaries. Until then, host-to-subagent context transfer
is experimental.

## Dependency manifest

The product manifest should describe what Shipyard tested without conflating a
Git commit with a semantic-version compatibility promise. A suitable shape is:

```yaml
schemaVersion: 1
dependencies:
  - id: matt-pocock-skills
    owner: external
    kind: agent-skill-bundle
    source:
      repository: https://github.com/mattpocock/skills
      refType: commit
      ref: 2ab958093e83e0ec752e6c1c5932da465bf23e0c
      subpath: skills
    license: MIT
    requiredFor: [planning, requirements, implementation, review]
    capabilities: [wayfinding, grilling, specification, tdd, code-review]
    integrity:
      receipt: matt-pocock-skills/state.json
    discovery:
      canonical: ~/.agents/skills
      claude: ~/.claude/skills
    adapter: shipyard-matt-skills
    policy:
      vendored: false
      autoUpdate: false
```

Each entry needs `id`, `owner`, `kind`, exact `source`, `license`,
`requiredFor`, `capabilities`, `integrity`, per-host `discovery`, `adapter`, and
update policy. Optional integrations use the same structure with an explicit
lane or feature gate. The installation receipt should record the observed
content hash and host versions separately from the reviewed source manifest.

## Setup and status checks

`shipyard-setup` and `shipyard-status` should report, without silently fixing:

- whether each dependency required for the selected profile, lane, and host is
  present;
- whether its reviewed commit/version and content hash match the manifest;
- whether required `SKILL.md` frontmatter, supporting files, and invocation
  metadata exist;
- whether one canonical definition is discoverable by the active host and
  ambiguous duplicate definitions are absent;
- whether the current host and runtime were actually tested with that adapter;
- whether CCPM is the supported skill-layout fork rather than a legacy command
  installation;
- whether the Cursor lane has the reviewed Pstack plugin and invoked
  capabilities;
- whether required Git, GitHub CLI, Node, or Python runtimes are available for
  the particular operation; and
- whether profile binding, actor selection, repository allowlists, metadata
  policy, and mutation locks validate before any external write.

An exact match passes. A recognized but untested newer version reports
`unverified`. Missing, modified, duplicated, or policy-incompatible content
fails with a specific remediation command or document. Upgrades are separate
reviewed changes.

## Migration inventory

The user-owned workflows contain useful mechanics, but their current authority
model predates Shipyard:

| Existing skill | Preserve inside Shipyard | Replace or prohibit |
| --- | --- | --- |
| `yolo-afk-dev` | lane classification, resumable state, retries, context recycling | blanket kickoff authority, origin-derived writes, legacy CCPM commands |
| `yolo-pr-review` | isolated worktree, merge-base review, validated findings, review/fix loop | implicit base merging, ungoverned GitHub review writes, approval without Shipyard exact-SHA evidence |
| `yolo-simple-dev-codex` | Codex orchestration and independent second-reviewer pattern | direct team pushes and PR creation outside topology policy |

The predecessor `justgames-*` mappings are:

- `justgames-delivery` -> the `shipyard` orchestrator plus profile rules;
- `justgames-ccpm-execute` -> CCPM host adapter;
- `justgames-review` -> `shipyard-review`;
- `justgames-acceptance-audit` -> generic exact-SHA acceptance engine;
- `justgames-issues` -> tracker adapter plus profile write allowlist;
- `justgames-sync` and `justgames-promote` -> staged-pair topology operations;
- `justgames-bug-framing` -> a later bug-framing adapter.

This is extraction, not a one-to-one rename. A temporary old-name shim may
resolve a validated Shipyard binding, delegate to the replacement, and emit a
deprecation warning. It must never reproduce the old unguarded behavior. Keep
the predecessor installed until its replacement passes the local lifecycle,
host-handoff, and private-fixture prototypes; then retire aliases in a separately
announced release.

## Licensing and attribution

Matt Pocock's skills, CCPM, and the reviewed Pstack plugin declare MIT licenses.
Shipyard should retain dependency names, source URLs, reviewed refs, licenses,
and any required notices in its manifest and third-party notices. Because v1
does not redistribute those projects, their source files do not need to be
copied into the Shipyard package. If code is later copied or modified, the
corresponding license and copyright notices must accompany that distribution.

User-owned `yolo-*` and `justgames-*` material needs an explicit Shipyard
license decision before public redistribution. Ownership alone should not be
treated as a public license.

## Open prototype boundary

This research settles dependency ownership, pins, capabilities, checks, and
migration direction. It deliberately does not claim that context envelopes,
skill invocation, reviewer separation, or exact-SHA handoff behave identically
inside all three hosts. Ticket 15 must prove those host mechanics with a
synthetic fixture before the v1 PRD promises them.

