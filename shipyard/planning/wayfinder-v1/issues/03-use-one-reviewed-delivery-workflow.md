# Use one reviewed-delivery workflow

Type: grilling  
Status: resolved

## Question

Should JustGames and personal repositories use different development
workflows, or share one workflow whose boundaries vary by profile?

## Answer

All profiles use one `reviewed-delivery` workflow. Large work uses Wayfinder,
then a CCPM PRD, technical epic, and vertical CCPM tasks. Small settled work
uses grill-with-docs, then `to-spec`, and uses `to-tickets` only when multiple
independent slices are valuable. Existing bug-framing policy remains a deferred
adapter rather than blocking v1.

Cursor execution routes to Pstack. Claude Code and Codex route to CCPM's default
multi-agent workflow. All lanes converge on acceptance evidence, independent
review, exact-SHA approval, topology-specific promotion, human merge, and
finalization.

The public skill surface is `shipyard`, `shipyard-setup`, `shipyard-status`,
`shipyard-review`, `shipyard-sync`, `shipyard-promote`, `shipyard-finalize`, and
`shipyard-help`. Internal capabilities include issue safety, bug routing,
acceptance validation, execution adapters, path policy, and context resolution.

Each skill remains small and links to progressive Markdown references. An agent
loads the workflow, topology, or operation document only when that stage needs
it.

## Comments

- Imported from the completed Shipyard grilling session on 2026-08-03.

