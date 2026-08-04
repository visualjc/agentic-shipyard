---
issue: 4
stream: A — Scoped GitHub REST authority
status: complete
---

Own only the REST adapter, API credential port, actor verification, safe
provider errors, and their deterministic tests listed in `../../4-analysis.md`.
Verify `/user` equals the bound profile actor before any write.  Credentials
must be ephemeral and redacted; `gh` is never used to select or switch an
identity.  Publish interface/type/error inventory for Stream B before tracker
implementation begins.

Implemented the scoped REST seam: `GitHubRestAdapter`, injected ephemeral API
credential resolver/transport, typed client/session contracts, safe provider
errors, and `verifyGitHubActor`.  Verification reads `/user` and requires the
configured login before returning a session capable of writes; no `gh` command
or global identity state is used.

Verification: targeted compiled tests passed (7/7): ordered viewer-before-write,
actor mismatch/no-write, missing credential/no-request, denied auth/no-write,
ephemeral authorization header, permission error redaction, and transport error
redaction. `npm run typecheck` passed.

Stream B inventory: import `GitHubRestClient`, `GitHubRestClientFactory`, `GitHubRestRequest`, and
`VerifiedGitHubSession` from `src/github/types.ts`; obtain the latter via
`verifyGitHubActor(expectedActorLogin, credentials, client)`, then use
`session.request` for reads and `session.write` for mutations.
