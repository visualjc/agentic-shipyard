---
name: slipway
description: Coordinate a complete paired-repository software delivery with Markdown playbooks and durable Git-backed state. Use when the user says “Use Slipway,” invokes `$slipway`, starts or continues feature, refactor, bug, research, prototype, review, delivery-PR follow-up, synchronization, promotion, pause, resume, or finalization work, or wants Slipway to select and run the appropriate installed skills.
---

# Slipway

Own the workflow. Ask the user only for product decisions, material scope choices, explicit tiny-lane permission, and required external-write gates.

Install and distribute `slipway` with every `slipway-*` direct-command skill as one atomic suite. Treat each direct command as a self-contained entry point that preflights and invokes this primary coordinator; keep shared playbooks, references, and assets here.

Use the host's explicit skill syntax when requested. Invoke `$slipway` in Codex or expose `/slipway` on hosts with slash-command skill invocation. Keep the workflow and safety gates identical across syntaxes.

## Private context bootstrap — mandatory

Private context is Slipway's extension plane for project rules,
knowledge-source routing, repository topology, tool requirements, and workflow
guidance. It may augment but never weaken core safety, cargo, identity, review,
or delivery gates.

After reading core safety, perform this bootstrap on every Slipway invocation
before classifying the request, searching repository source, reading product
files, invoking a project tool, creating a worktree, or taking another workflow
action:

1. Read `<agentic-root>/.slipway-local/binding.md`.
2. Use the binding to locate the canonical ledger context tree and validate any
   ignored local cache plus its recorded tree ID.
3. Read the private context manifest from a validated source.
4. Load every applicable coordinator-targeted module declared
   `operations: [all]`.
5. Classify the request, or preserve the forced operation of a direct entry
   point.
6. Before the first operation-specific action, load every additional
   applicable required module.

If the binding, context tree, cache, manifest, or a required module cannot be
read or validated, warn before proceeding and name the unavailable component,
reason, and practical limitation. A clearly read-only request may continue
with fallback discovery tools after that warning, but it must mark private
context as degraded and must not claim compliance with unavailable guidance or
tool requirements. If the requested effect is ambiguous, treat it as mutating.
Degraded fallback is response-only: do not initialize a lane, create or update
a run shard, append an event, or use its result to satisfy a review or delivery
gate. Mutation, lane execution, provider writes, cargo transfer, main updates,
and other delivery mutations remain blocked until required context is healthy.
The only repair exception is an explicitly invoked `setup` operation, which may
perform its confirmed context initialization or repair scope under the setup
contract. Never overwrite divergent context as part of fallback.

Forced `status` completes steps 1–4 from validated available sources and then
reports context health. It remains read-only: do not hydrate, repair, execute a
lane, or perform external writes. If baseline context is unavailable, warn and
continue only the status scan in degraded mode.

## Start

1. Read [safety.md](references/safety.md).
2. Complete the mandatory [private context lifecycle](references/store.md#private-context-lifecycle) through baseline `operations: [all]` module loading. For non-status operations, hydrate a missing or proven-safe stale cache when needed. Apply the explicit degraded read-only fallback or mutation block; do not silently bypass bootstrap.
3. Classify the request using [classification.md](references/classification.md), or preserve a direct entry point's forced operation. State the lane and evidence. For `tiny-change`, request explicit permission; without it, select `small-development`.
4. Determine whether the request starts a run, resumes one, or operates on the portfolio. Use the complete agentic work-branch name as the run identity.
5. Resolve additional modules for the selected operation and load every applicable required coordinator entrypoint before its first relevant action. Report activated and skipped modules, including the reason for any degraded fallback; persist that selection only when healthy context permits workflow-state writes. A missing required module blocks mutation but permits an explicitly warned read-only fallback.
6. Preflight every capability required by the selected lane immediately before lane execution using [capability-preflight.md](references/capability-preflight.md). Block that lane when a capability is absent or ambiguous.
7. Before product development, bug investigation, research, or prototype work, apply the [run start contract](references/run-start.md). Let read-only research proceed autonomously after that local initialization; do not add a human gate unless it encounters a product decision or external write.
8. Load exactly one primary playbook. Load another only when the current playbook routes to it.

## Direct entry points

When a `slipway-*` entry point invokes this coordinator, preserve its forced operation instead of reclassifying it: setup loads the [setup contract](references/setup.md) and [safety boundaries](references/safety.md); status scans the [store](references/store.md) read-only; resume loads [session continuity](playbooks/session-continuity.md); review loads [review-only](playbooks/review-only.md) and adds the [delivery gate](references/delivery-gate.md) only for final delivery review, review renewal, or cargo inspection; sync loads [synchronization](playbooks/sync-finalization.md); promote loads [promotion](playbooks/promotion.md); finalize loads [finalization](playbooks/sync-finalization.md). Require the entry point's exact branch, SHA, or target arguments before acting.

## Playbooks

- [tiny-change.md](playbooks/tiny-change.md)
- [small-development.md](playbooks/small-development.md)
- [large-development.md](playbooks/large-development.md)
- [bug-investigation.md](playbooks/bug-investigation.md)
- [bug-fix.md](playbooks/bug-fix.md)
- [research-prototype.md](playbooks/research-prototype.md)
- [review-only.md](playbooks/review-only.md)
- [agentic-pr.md](playbooks/agentic-pr.md)
- [delivery-follow-up.md](playbooks/delivery-follow-up.md)
- [session-continuity.md](playbooks/session-continuity.md)
- [promotion.md](playbooks/promotion.md)
- [sync-finalization.md](playbooks/sync-finalization.md)

## Coordinate

- Use Matt Pocock skills as the baseline planning and building path. Use pstack only when project or run preferences explicitly select it. Read [build-providers.md](references/build-providers.md) before dispatching implementation.
- Index canonical Wayfinder, grilling, research, prototype, specification, ticket, QA, and review artifacts. Do not duplicate their contents.
- Keep product work on the agentic work branch. Keep agentic metadata in separate commits. Treat only exact reviewed product-only commits as delivery cargo. Ledger context and the ignored `.slipway-local/context/` cache are never a commit, PR diff, or cargo; reviewed Slipway context templates under the configured product path remain ordinary product source.
- Update the run shard after each completed phase and before pause. Record observed facts, exact SHAs, open gates, and exactly one next action.

## Reusable assets

- During setup, copy [project.md](assets/project.md), [preferences.md](assets/preferences.md), [portfolio.md](assets/portfolio.md), the machine-local [binding.md](assets/binding.md), and the canonical [private context assets](assets/context/manifest.yaml).
- When starting or reconciling a run, copy [manifest.md](assets/manifest.md), [run-status.md](assets/run-status.md), [gates.md](assets/gates.md), and [artifacts.md](assets/artifacts.md).
- Before delegation or independent review, copy [worker-brief.md](assets/worker-brief.md) or [reviewer-brief.md](assets/reviewer-brief.md).
- When recording immutable evidence, copy [event.md](assets/event.md).
- During finalization, copy [archive-summary.md](assets/archive-summary.md).

End every response with the lane, work branch or `portfolio`, verified current phase, open gate if any, and one next action.
