# Slipway local prototype specification

## Problem Statement

Jim needs an agent to remember and run the complete software-delivery workflow across a private agentic repository and a clean team-facing delivery repository. The existing Shipyard policy engine provides enforceable lifecycle machinery, but its TypeScript architecture overlaps with skills Jim already uses and is expensive to evolve. The earlier skills-first experiment also inherited Shipyard naming, CCPM routing, and an agentic-worktree state model that conflict with the intended repository lifecycle.

The workflow must select the right planning and building skills for the effort, keep concurrent work understandable, transfer only product cargo between repositories, handle team feedback on the delivery PR by returning to the agentic work branch, and recover from a fresh session without requiring Jim to remember every playbook step.

## Solution

Create Slipway as a separate skills-first product beside Shipyard. `$slipway` classifies a request, explains the chosen lane, checks required capabilities, selects a focused Markdown playbook, and coordinates existing skills rather than reimplementing them. Hosts with slash-command skill invocation may expose the same entry point as `/slipway`; direct commands support setup, status, review, synchronization, promotion, resume, and finalization.

Slipway uses Matt Pocock's planning and implementation skills as its complete baseline. Large work begins with Wayfinder; small work begins with grill-with-docs; confirmed bugs begin with diagnosing-bugs; implementation proceeds through to-spec, to-tickets, implement, TDD, and code-review as appropriate. Pstack is an explicit opt-in build provider for users who want enhanced fan-out and orchestration. CCPM is outside the first iteration.

Durable state lives on a parallel ledger branch. Each active run owns a shard identified by its complete, unique agentic work-branch name. Different runs update disjoint shards; a single coordinator owns each run's mutable summary while workers and reviewers add immutable event records. Status derives the portfolio from active shards rather than requiring every worker to rewrite a global status file. Finalization compacts the completed run into portfolio history and removes the active shard from the ledger branch's current tree while Git history retains the detailed evidence.

Product development always occurs on an agentic work branch created from clean agentic main. A ledger-backed private context registry supplies Repo-B-only instructions and tool metadata; Slipway explicitly loads selected modules from an ignored `.slipway-local/context/` cache before lane work, and no tracked public bootstrap or live context can become product cargo. One agentic PR records that branch as the private development/review workspace and is never the team feedback or merge surface. Reviewed product-only commits are cherry-picked to the delivery PR branch. Team feedback arrives on that delivery PR, is implemented and tested on the same agentic work branch, and is cherry-picked back to the same delivery PR after a renewed exact-SHA delivery gate. After human merge, agentic main fast-forwards to authoritative delivery main, context is refreshed, the agentic PR closes without merge, and only then may the run finalize.

## User Stories

1. As a developer, I want to say “Use Slipway” so that the agent assumes responsibility for selecting and running the workflow.
2. As a developer, I want explicit `$slipway` or host `/slipway` commands so that I can guarantee the coordinator is invoked.
3. As a developer, I want Slipway to detect incomplete setup before starting work so that repository roles and safety assumptions are not guessed.
4. As a developer, I want `$slipway-setup` to discover local facts read-only and ask only for decisions it cannot inspect.
5. As a developer, I want setup to confirm the agentic repository, delivery repository, base branches, accounts, and cargo exclusions before writing state.
6. As a developer, I want setup to delegate Matt-skill project conventions to the Matt setup skill so that Slipway does not duplicate them.
7. As a developer, I want classification to distinguish tiny, small, large, bug, review-only, delivery-follow-up, synchronization, and finalization work.
8. As a developer, I want Slipway to explain why it selected a lane so that I can correct a bad assumption.
9. As a developer, I want the tiny-change lane to require my permission so that useful planning is not silently skipped.
10. As a developer, I want an unanswered tiny-change proposal to fall back to small development so that ambiguity fails toward more planning.
11. As a developer, I want large work to route through Wayfinder before specification so that unresolved decision fog is handled explicitly.
12. As a developer, I want small work to route through grill-with-docs, to-spec, and to-tickets so that bounded work still has an executable contract.
13. As a developer, I want raw incoming reports triaged only when they are not already agent-ready so that structured tickets are not needlessly reframed.
14. As a developer, I want bug claims diagnosed before implementation so that requirement conflicts and environment failures are not patched as code defects.
15. As a developer, I want a confirmed bounded bug to proceed through a regression test, implementation, and review.
16. As a developer, I want a broader bug outcome to re-enter effort classification so that it receives the product planning its scope requires.
17. As a developer, I want read-only research to proceed autonomously after normal local work-branch initialization so that factual uncertainty can be reduced without unnecessary interruption.
18. As a developer, I want every prototype to stop for my feedback so that throwaway code settles the intended design question before production work.
19. As a developer, I want Matt's implement skill to be the default builder so that Slipway works wherever the baseline Matt skills are installed.
20. As a developer, I want to opt into pstack per project or per run so that large ticket frontiers can gain orchestration without changing the planning workflow.
21. As a developer, I want missing lane capabilities to block only that lane so that setup, status, and unrelated work remain usable.
22. As a developer, I want every run to use its complete work-branch name as its identity so that commands and durable state match the Git artifact I already recognize.
23. As a developer, I want branch names to be unique and never reused so that historical run evidence cannot be mistaken for new work.
24. As a developer, I want a branch rename to require explicit state migration so that a run cannot silently lose its durable history.
25. As a developer, I want concurrent runs to update separate ledger shards so that agents do not overwrite one shared status record.
26. As a developer, I want workers and reviewers to append immutable event records so that multiple agents within one run do not race on mutable summaries.
27. As a developer, I want one coordinator to own a run's status, gates, and artifact index so that conflicts have a clear resolution authority.
28. As a developer, I want `$slipway resume <branch>` to reconstruct the current phase, verified evidence, open gates, and one next action without the original chat.
29. As a developer, I want `$slipway-status` to summarize all active run shards so that I can see planned, in-flight, paused, blocked, and delivery-waiting work.
30. As a developer, I want Wayfinder, research, prototype, specification, ticket, QA, and review artifacts indexed rather than copied so that each producing skill retains canonical ownership.
31. As a developer, I want development to occur only on an agentic work branch so that agentic main remains a clean delivery mirror.
32. As a developer, I want product and agentic metadata in separate commits so that delivery cargo can be selected by exact commit.
33. As a developer, I want a final exact-SHA delivery gate after all ticket implementation so that integrated behavior and cargo boundaries are independently checked.
34. As a developer, I want only reviewed product commits cherry-picked into the delivery repository so that `.ua`, Slipway state, PRDs, planning ADRs, research, and prototypes stay private.
35. As a developer, I want promotion to preflight the exact account, repository, base, branch, PR, SHAs, commits, and excluded paths before any external write.
36. As a developer, I want the delivery PR to remain the team's only review and merge surface so that coworkers never need the agentic repository.
37. As a developer, I want accepted team feedback implemented and tested on the original agentic work branch so that the delivery branch never becomes an independent source of changes.
38. As a developer, I want every delivery-PR revision to renew QA and independent review for the new exact agentic SHA.
39. As a developer, I want reviewed revision commits cherry-picked back onto the same delivery PR branch so that the team sees one continuous delivery conversation.
40. As a developer, I want clearly in-scope feedback handled under scoped standing authorization while behavior, scope, architecture, or unsafe requests return to me.
41. As a developer, I want pushes and narrow PR replies limited to one preflighted PR while merge, force-push, deletion, authentication, and deployment remain human-gated.
42. As a developer, I want delivery main fast-forwarded into agentic main after merge so that agentic main exactly follows the authoritative product history.
43. As a developer, I want one recorded agentic PR as the private development/review workspace so that its exact target can be resumed and later closed safely.
44. As a developer, I want agentic PRs closed without merge so that agentic-only commits never enter agentic main.
45. As a developer, I want finalization blocked until merge, synchronization, PR closure, final SHA recording, and artifact retention are complete.
46. As a developer, I want finalization to compact completed work into portfolio history while Git retains the detailed run evidence.
47. As a developer, I want Slipway to state honestly that skills are guidance rather than a security boundary so that I understand where enforcement actually comes from.
48. As an evaluator, I want Slipway and Shipyard to remain separate products so that their usability, code, safety, and maintenance trade-offs can be compared fairly.
49. As a developer, I want canonical skills kept separate from host installation artifacts so that the repository has one source of truth without tracked discovery links or generated tool directories.
50. As a developer, I want one global Agent Skills installation to serve Cursor, Codex, and compatible hosts so that duplicate host copies cannot disagree.
51. As a developer, I want Slipway to load private project context from the ledger without a tracked repository bootstrap so that the delivery repository has zero awareness of the extension system.
52. As a developer, I want declarative context modules selected by operation, repository marker, and available capability, then propagated deliberately to coordinators, workers, and reviewers.
53. As a developer, I want arbitrary sessions that bypass Slipway to receive no guaranteed private augmentation so that portable behavior does not depend on host-specific instruction discovery.

## Implementation Decisions

- Keep Shipyard as the policy-engine product and name the skills-first product Slipway. Do not describe either as legacy or lite.
- Isolate Slipway as its own package without moving or modifying the active Shipyard implementation during this experiment. A later integration branch may reorganize both into a full monorepo.
- Build only Markdown skills, one-level playbooks/references, reusable briefs, YAML discovery metadata, and plain durable-state templates in the first iteration.
- Keep canonical skill source only under `packages/slipway/skills/`. Do not track root `.agents/`, `.cursor/`, `.claude/`, generated `build/`, or host plugin artifacts.
- Install the complete suite into `~/.agents/skills/` for Cursor, Codex, and compatible Agent Skills hosts. Install separately into `~/.claude/skills/` only for Claude Code. Do not install a duplicate under `~/.cursor/skills/`.
- Keep v1 installation instruction-driven. Defer an installer, generated build tree, and tool-specific plugin packaging until an actual host transformation or repeated failure justifies them.
- Do not add a service layer, state machine, domain model runtime, schema framework, provider adapter, Git abstraction, or helper script. Propose a narrowly scoped helper only after repeated deterministic failure demonstrates the need.
- Make `$slipway` the primary coordinator. Provide direct setup, status, review, sync, promote, resume, and finalize commands for explicit invocation.
- Require paired repositories in the first iteration. Setup uses read-only discovery, a proposed binding, explicit user confirmation, and initialization; it never creates repositories or changes remotes, credentials, or the delivery branch.
- Keep portable project preferences separate from machine-local repository bindings and keep both out of product ancestry.
- Keep one canonical private context registry on the ledger. Version it by the context directory's Git tree ID, cache it only under ignored `.slipway-local/context/`, and fail closed rather than overwriting divergent local context. Do not create a tracked public extension contract.
- Treat Matt skills as the baseline capability set. Use Wayfinder for large decision fog, grill-with-docs for bounded requirements, research and prototype for questions, to-spec and to-tickets for contracts, implement and TDD for building, and code-review for review.
- Make pstack an explicit opt-in build provider and defer CCPM.
- Classify before execution. Require explained user permission for the tiny lane and fall back to small development without permission.
- Use the full, validated work-branch name as the run identity. Prohibit reuse and slash-delimited prefix overlap with another active run. Treat rename as an explicit migration that records the former name.
- Store each active run in a disjoint shard on a parallel ledger branch. Give one coordinator ownership of mutable summaries, require workers/reviewers to add unique immutable events, and finalize by removing exact owned files rather than recursively deleting a branch-derived directory.
- Derive portfolio status by scanning active run records. Update compact global portfolio history only during coordinated setup or finalization.
- Route Matt setup drafts into the private `matt-skills` context module and refresh/verify the cache. Do not commit Matt setup output per run; other code-adjacent planning artifacts remain separate from cargo.
- Require agentic work branches to start from agentic main. Never develop on agentic main or the ledger branch.
- Require product-only commit boundaries and a fresh exact-SHA delivery gate covering repository QA, acceptance, independent review, and cargo exclusions.
- Create and durably record one agentic PR as the private development/review workspace. Never use it for team feedback or merge it into agentic main.
- Cherry-pick exact reviewed cargo commits to the delivery PR branch. Never filter mixed commits during transfer.
- Treat the delivery PR as feedback authority and merge surface. Implement accepted revisions only in the agentic work branch, renew the delivery gate, and cherry-pick the new cargo to the same delivery PR.
- After human merge, fast-forward agentic main to the authoritative delivery-main commit, close the agentic PR without merge, retain the chosen development evidence, then finalize the run.
- Treat plain records as claims that must be verified against Git and provider state. They provide visibility and recovery, not authorization, atomicity, locking, or enforcement.

## Testing Decisions

- Use the `$slipway <request>` boundary as the primary behavioral seam. Test the externally visible route, gates, durable records, evidence, and next action rather than internal Markdown phrasing.
- Run scenario tests in fresh agent contexts so success depends on the installed skill contents rather than this design conversation.
- Cover large development, small development, tiny-change permission, ambiguous bugs, research/prototype gates, worker and exact-SHA reviewer recording, pause/resume, concurrent run shards, promotion preflight, delivery feedback revision, capability failure, and finalization.
- Use local repositories and fixtures. Do not push, mutate GitHub, change authentication, rewrite remotes, merge, or delete live branches during validation.
- Validate every skill's frontmatter and every discovery metadata file with the available skill validator plus targeted YAML checks.
- Validate that tracked product history contains no root host-installation paths and that Cursor discovers the suite exactly once from `~/.agents/skills/`.
- Inspect the complete diff from the accepted product SHA and confirm that all new Slipway behavior remains Markdown/plain-file directed with no helper or runtime code.

## Out of Scope

- Replacing, moving, or deprecating the TypeScript Shipyard engine.
- A shared runtime or core library between Shipyard and Slipway.
- CCPM integration in Slipway's first iteration.
- A single-repository topology.
- Live GitHub, Linear, remote, credential, push, PR, merge, deployment, or branch-deletion mutations during prototype validation.
- Enforced locking, atomic multi-writer transactions, typed schemas, provider authorization, credential isolation, or protection against an agent ignoring instructions.
- Automatic conflict resolution during cherry-pick, synchronization, or ledger commits.
- A comprehensive release platform or compatibility with every agent host.
- Cursor marketplace/plugin packaging, generated host distributions, and an installation executable.

## Further Notes

The experiment should compare Slipway and Shipyard on time to first use, number of human interruptions, recovery from a fresh session, maintenance effort, false blocks, and unsafe near misses. Retain selected Shipyard machinery only where real Slipway trials show that agent instructions and plain files are insufficient.
