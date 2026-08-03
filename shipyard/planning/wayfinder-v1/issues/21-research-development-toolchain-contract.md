# Research the development-toolchain contract

Type: research  
Status: resolved

## Question

What exact external capabilities, skill names, versions or SHAs, installation
locations, invocation metadata, licenses, and host guarantees must Shipyard v1
require from Matt Pocock's skills, the maintained CCPM fork, Cursor Pstack,
Claude Code, Codex, and Cursor?

The answer must:

- separate universally required capabilities from lane-specific and optional
  integrations;
- map each required capability to its current upstream project and identify
  whether a stable interface actually exists;
- propose the dependency-manifest schema and the checks run by setup and
  status, without implementing them;
- distinguish tested compatibility from unsupported or experimental versions;
- confirm attribution and redistribution obligations for every dependency;
- inventory `yolo-afk-dev`, `yolo-pr-review`, `yolo-simple-dev-codex`, and the
  predecessor `justgames-*` skills, then map useful behavior to Shipyard public
  skills or internal host adapters;
- define a compatibility-alias and retirement policy that does not break the
  currently installed workflows; and
- identify any dependency behavior that must instead be answered by the host
  context-handoff prototype.

Use primary upstream documentation and the existing local provenance records.
Do not install, upgrade, vendor, rename, or delete skills while completing the
research.

## Comments

- This is on the initial frontier.
- The ownership and non-vendoring direction is settled in ticket 20; this
  ticket resolves the evidence-dependent contract needed by the v1 PRD.

## Answer

Shipyard owns the lifecycle and safety boundary while consuming exact reviewed
external dependencies. The initial tested contract pins Matt Pocock's 20-skill
bundle at `2ab958093e83e0ec752e6c1c5932da465bf23e0c`, the maintained
`visualjc/ccpm` skill-layout fork at
`cdb97474904ab2cdc7d391aa17393b444a28be3e`, and Cursor Pstack 0.14.0 at
`fa16d695b35ccf4ea179d976e5aaee0834a25b0b` for the Cursor lane.

Setup and status will verify a machine-readable capability manifest, exact
source and content receipts, host discovery, duplicates, runtimes, adapters,
and Shipyard policy. No dependency auto-upgrades or legacy CCPM command guesses
are allowed. Existing `yolo-*` and `justgames-*` behavior is extracted behind
Shipyard guards; old-name aliases may delegate temporarily only after their
replacement is validated.

Full capability, manifest, licensing, migration, and host-prototype boundaries
are in
[`../research/development-toolchain-contract.md`](../research/development-toolchain-contract.md).
