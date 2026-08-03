# Provision disposable GitHub fixtures

Type: task  
Status: resolved  
Blocked by: 16

## Question

Provision only the exact private GitHub fixtures approved by
"Choose disposable GitHub fixtures," verify the configured actors' access, and
record their URLs and cleanup plan so the real-host prototype can proceed.

This task must not create, modify, or authorize anything under SentientDogs and
must not reuse a production repository. It resolves when the fixtures and their
access checks exist exactly as approved.

The approved fixture pair is `visualjc/shipyard-fixture-staged` and
`NativeInteractive/shipyard-fixture-staged`, both private. Every GitHub command
must use a command-scoped `visualjc` credential after verifying `gh api user`
returns `visualjc`; never change the globally active GitHub CLI account. Do not
use or associate `justgamesjim`, a Just Games email identity, SentientDogs, or
any other Just Games resource. Seed only generated synthetic code.

## Comments

- This is an external mutation and therefore requires a fresh, explicit user
  invocation when it reaches the frontier.
- Multi-account switching and the optional single-repository fixture are
  deferred.

## Answer

Jim explicitly authorized provisioning and retaining the exact approved pair.
Both repositories were created private and verified with `ADMIN` access through
a command-scoped `visualjc` credential:

- <https://github.com/visualjc/shipyard-fixture-staged>
- <https://github.com/NativeInteractive/shipyard-fixture-staged>

Only generated synthetic code was seeded. The globally active GitHub CLI
configuration was not changed, and no Just Games resource or identity was used.

The fixtures are retained for inspection until Jim accepts the lifecycle
findings. Cleanup then deletes only these two exact repositories with the same
command-scoped `visualjc` identity.
