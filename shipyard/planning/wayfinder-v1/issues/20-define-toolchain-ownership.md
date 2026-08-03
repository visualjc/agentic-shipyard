# Define Shipyard's toolchain ownership model

Type: grilling  
Status: resolved

## Question

Is Shipyard a standalone agent-development system, should it redistribute the
third-party skills and engines it uses, and should the existing user-owned
`yolo-*` skills survive as a parallel skill family?

## Answer

Shipyard is an opinionated orchestration layer built around Matt Pocock's
composable engineering skills, CCPM's PRD and multi-agent execution model, and
host-specific tooling such as Cursor Pstack. It owns the governed lifecycle,
metadata boundaries, evidence and review gates, promotion rules, host adapters,
and compatibility contract that make those systems operate as one workflow.

Shipyard owns code that implements Shipyard behavior. External projects remain
external by default: record their upstream repository, reviewed SHA or version,
required capabilities, and tested compatibility in a machine-readable manifest
and link to their primary documentation. Do not maintain a second physical copy
of Matt's skills, Pstack, or CCPM in a generic `vendor/` directory merely for
convenience. Vendoring requires a separate justification.

The existing user-owned `yolo-*` skills are migration inputs, not a permanent
parallel product surface. Extract their useful execution, recovery, context,
and review behavior into Shipyard's public skills or internal host adapters
rather than mechanically renaming each skill. Temporary delegating aliases may
protect existing workflows until the replacements are validated.

The supported toolchain distinguishes required workflow capabilities from
situational skills. Its exact skill subset, version pins, host compatibility,
installation checks, and migration mapping must be researched before the CCPM
PRD freezes acceptance criteria.

## Comments

- Added from the accepted dependency and naming discussion on 2026-08-03.
- This decision changes product positioning and distribution policy but does
  not authorize copying, installing, renaming, or deleting any skill.
