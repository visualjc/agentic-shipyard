# Slipway compared with Shipyard

| Dimension | Shipyard policy engine | Slipway skills system |
| --- | --- | --- |
| Usability | Users enter a CLI/domain lifecycle with explicit engine concepts. | Users can say “Use Slipway” or invoke a direct `$slipway-*` command; the coordinator selects familiar skills and reports one next action. |
| Amount of code | The accepted product has 120 TypeScript source files and 71 test files plus skills/docs. | Markdown skills, playbooks, templates, fixtures, and YAML metadata; no new runtime or helper code. |
| Safety | Typed inputs, adapters, tested state transitions, locks, and provider guards can enforce policy when the engine is used. | Instructions require preflight, exact SHAs, cargo inspection, and human gates but cannot enforce them. Git/provider controls remain authoritative. |
| Recovery | Can provide deterministic, schema-validated transitions and idempotent commands. | Reconstructs from readable branch-named shards and observed Git/provider state; no transaction or atomicity guarantee. |
| Concurrency | A runtime can lock and coordinate shared state. | Separates runs into disjoint paths, uses one coordinator per run and immutable events, then relies on scoped Git commits and retry. |
| Maintenance | Provider, Git, schema, recovery, packaging, and domain layers evolve together. | Most changes affect one playbook or template; instruction drift and agent judgment require scenario testing. |
| Planning/build fit | Risks duplicating Wayfinder, Matt skills, pstack, and repository-specific workflows. | Treats those skills as canonical capabilities and adds routing, paired-repository movement, portfolio state, and delivery lifecycle. |
| Fit for Jim | Stronger when runtime enforcement justifies setup and maintenance cost. | Better match when Jim wants the agent to remember the playbook, preserve private agent metadata, and repeatedly revise the normal team PR from agentic work. |

## Recommendation

Continue Slipway as a parallel experiment. Use it on several non-critical paired-repository deliveries and compare time to first use, human interruptions, fresh-session recovery, false blocks, maintenance effort, and unsafe near misses. Retain or reuse selected Shipyard code only when trials prove that instruction and plain-file coordination are inadequate. Do not collapse the products or add a shared runtime before that evidence exists.
