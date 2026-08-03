# Choose disposable GitHub fixtures

Type: grilling  
Status: resolved  
Blocked by: 12

## Question

Which private, disposable GitHub repositories and actors should validate
Shipyard's real-host behavior without touching SentientDogs or production
repositories?

Decide the development and destination owners, repository names, expected
actors, visibility, retention, cost, cleanup, and explicit authorization
boundary. The recommendation is a same-name staged pair under two accounts Jim
controls, plus a single-repository fixture, but no external resource is created
until Jim approves the exact checklist.

## Comments

- Blocked until the local lifecycle demonstrates that external fixtures are
  necessary and the expected operations are stable.

## Answer

Use one private, same-name staged pair:

- development: `visualjc/shipyard-fixture-staged`;
- destination: `NativeInteractive/shipyard-fixture-staged`;
- GitHub actor for both sides of this first fixture: `visualjc`;
- visibility: private; and
- retention: only through the GitHub lifecycle prototype and acceptance of its
  findings, followed by explicit cleanup.

This tests a personal development repository delivering to an organization-
owned destination repository while keeping all fixture activity outside Just
Games. Read-only verification on 2026-08-03 confirmed that `visualjc` is an
active owner/admin of `NativeInteractive`, that the organization permits private
repository creation, and that `visualjc` has administrative repository access.

The temporary fixture boundary is strict: do not authenticate as, create under,
invite, mention as an actor, or otherwise associate the fixtures with
`justgamesjim`, SentientDogs, a Just Games email identity, or any other Just
Games-owned resource. Multi-account switching is deferred until Jim explicitly
lifts this boundary.

The repositories contain only a generated synthetic product and Shipyard test
state. They contain neither Shipyard's implementation source nor JustGames
source code.

This decision does not create anything. Provisioning remains ticket 17 and
requires a separate explicit invocation. That task must scope every GitHub
command to the stored `visualjc` credential without changing the globally active
GitHub CLI account.
