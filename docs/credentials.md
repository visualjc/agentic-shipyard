# Credentials

Shipyard treats GitHub REST and authenticated Git as separate credential
boundaries. A REST credential is resolved only by the GitHub REST adapter;
a Git transport credential is accepted only by the Git transport service.
Neither credential belongs in a profile, binding, remote URL, command argument,
ledger, status projection, or diagnostic.

For each authenticated Git child process, Shipyard first reads the named
remote's raw local URL with includes disabled and no credential present. It
requires a credential-free `https://github.com/<owner>/<repo>[.git]` URL, then
places only that URL in a disposable bare Git directory. The credentialed
process uses that directory as its Git directory, so repository, system, and
global configuration cannot provide helpers, proxies, URL rewrites, upload-pack
commands, or extra headers. The transport token is supplied only through that
child process's environment as a scoped Git HTTP authorization header, with an
empty preceding header value that resets lower-priority multi-valued headers
and terminal prompting disabled.

Every production Git child receives a minimal allowlisted environment: it does
not inherit `GIT_*`, `GH_*`, `GITHUB_*`, `DEVELOPER_DIR`, `SDKROOT`, or
`TOOLCHAINS`. That matters on macOS, where `/usr/bin/git` is an xcrun shim and
developer-tool variables could otherwise select another executable. System and
global Git configuration are explicitly disabled. The environment is not
persisted and Shipyard does not run `gh auth`, `gh auth switch`, or any other
command that changes the global GitHub CLI account.

The Node runner invokes a canonical absolute Git executable (`/usr/bin/git` by
default), never a bare `git` looked up through `PATH`. On macOS Shipyard relies
on the platform-default developer toolchain after clearing developer selection
variables; deployments that require a non-default Git should pass its final,
existing absolute executable explicitly. Deployments and tests
that use another executable must provide its existing absolute path to the
runner factory; relative paths and command names are rejected. Default Git is
resolved only when a Git operation runs, never while importing the package.
Local consumers can inject the same explicit executable with
`createGitLedgerStore(repositoryPath, executable)` and
`createNodeWorkspaceGit(executable)`; the convenient default ledger/workspace
adapters remain lazy for hosts where `/usr/bin/git` is unavailable.

The public package intentionally exposes these safe Git factories and typed
provider contracts, not raw REST transport constructors. Provider HTTP wiring
is an internal command-scoped boundary.

Do not paste a token into a remote URL, CLI argument, configuration file, or
bug report. If Git output includes an authorization header or URL user-info,
Shipyard redacts it before returning an error; operators should still revoke a
token that may have reached an external log.

REST resolver failures intentionally return a generic credential-resolution
error instead of forwarding resolver diagnostics. HTTP, transport, client
factory, and actor-verification failures redact the exact resolved credential
value, including values that do not look like conventional GitHub tokens.

## Private disposable tracker fixture

The private GitHub fixture is opt-in and must use an approved disposable
development repository and a least-privileged test credential supplied by the
operator's credential store. It exercises the real tracker: creates a marked
development issue and PR, confirms a second call discovers the same IDs, then
closes both in cleanup. It is not part of the deterministic test suite.
It has no `NativeInteractive` configuration path and must not make a real
GitHub call unless an operator explicitly performs the approved fixture run.
Before and after a fixture run, an operator may inspect `gh auth status`; the
fixture must not switch or otherwise mutate its active account. Never record
the credential, raw command environment, or a remote containing credentials in
fixture evidence.

The executable fixture harness is enabled only with
`SHIPYARD_PRIVATE_GITHUB_FIXTURE=1` plus an explicit disposable
repository that exactly matches `SHIPYARD_PRIVATE_GITHUB_REPOSITORY` and
`SHIPYARD_PRIVATE_GITHUB_APPROVED_REPOSITORY`, the documented mutation
acknowledgement, token, expected actor, existing head/base refs, and exact
canonical lowercase 40- or 64-hex head SHA. The existing head ref must be
exactly `shipyard/<stable-delivery-id>`; the fixture derives its delivery ID
and record marker from that operator-created branch so the branch and tracker
authority cannot diverge. Use a fresh uniquely named branch for each fresh
fixture marker. It uses the production REST
transport and guarded tracker to
preflight `/user` and the exact encoded head-branch endpoint, requiring the
live branch name and commit SHA to match the configured values before any
local or provider mutation. It then creates the marked issue/PR pair and proves
idempotent discovery before cleanup. Cleanup binds one credential-scoped client, freshly verifies
the configured actor, and permits only exact close requests for those created
records in the separately approved repository. It is skipped by the normal
test command, makes zero default-suite network calls, never invokes `gh`, and
refuses NativeInteractive or any repository value containing a credential or
URL.
