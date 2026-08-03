# Prototype GitHub identity and pull-request lifecycle

Type: prototype  
Status: resolved  
Blocked by: 13, 17

## Question

Do profile-scoped GitHub identities, normal destination-owned pull requests,
append-only review revisions, ledger/tag retention, and final cleanup behave as
designed on real GitHub fixtures without changing the global active `gh`
account?

The initial prototype validates one explicitly scoped `visualjc` actor across a
personal development owner and the `NativeInteractive` organization owner,
authentication failure, issue-write targeting, personal/development PR review,
destination PR creation and update, approval invalidation after revisions,
human-merge simulation, tag reachability, branch cleanup, and zero metadata
leakage. It must also confirm that no fork PR is created.

Multi-account switching is deferred. This prototype must not use or associate
`justgamesjim`, SentientDogs, a Just Games email identity, or any other Just
Games resource. The final v1 boundary must not claim multi-account behavior from
this evidence.

The answer should identify any GitHub or branch-protection behavior that changes
the v1 contract.

## Comments

- Blocked by the proven resolver and explicitly provisioned disposable fixtures.

## Answer

The real private-fixture lifecycle completed with Codex as the only live agent
host. It created a development-only issue, two exact-SHA Codex review rounds, a
normal `NativeInteractive`-owned destination PR, one append-only destination
revision after destination feedback, an exact-head merge, development-main
resynchronization, close-without-merge development cleanup, and
development-only ledger/tag retention. Destination `main` contained no Shipyard
metadata, and the globally active GitHub CLI configuration was unchanged.

Two implementation constraints emerged. Git commands must disable inherited
credential helpers and use an ephemeral scoped credential independently of
`GH_TOKEN`; and deterministic mutations should use GitHub REST endpoints because
the installed `gh pr edit` failed on retired Projects Classic GraphQL fields.
The successful resume proves finalization must be checkpointed and resumable.

The same scoped actor authored both fixture PRs, so official approval dismissal,
branch-protection variations, distinct actors, and multi-account switching
remain deferred. V1 must rely on exact-SHA Shipyard attestations rather than
GitHub approval state for its own correctness. Full evidence is in
[`../prototypes/github-pr-lifecycle/findings.md`](../prototypes/github-pr-lifecycle/findings.md).
