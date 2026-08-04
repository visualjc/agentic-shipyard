# Credentials

Shipyard treats GitHub REST and authenticated Git as separate credential
boundaries. A REST credential is resolved only by the GitHub REST adapter;
a Git transport credential is accepted only by the Git transport service.
Neither credential belongs in a profile, binding, remote URL, command argument,
ledger, status projection, or diagnostic.

For each authenticated Git child process, Shipyard disables inherited
`credential.helper` configuration with command-scoped Git configuration. The
transport token is supplied through that child process's environment as a
scoped Git HTTP authorization header, with terminal prompting disabled. The
runner removes inherited `GIT_*`, `GH_*`, and `GITHUB_*` variables before it
starts Git, so those variables cannot supplement this credential boundary. The
environment is not persisted and Shipyard does not run `gh auth`, `gh auth
switch`, or any other command that changes the global GitHub CLI account.

The Node runner invokes a canonical absolute Git executable (`/usr/bin/git` by
default), never a bare `git` looked up through `PATH`. Deployments and tests
that use another executable must provide its existing absolute path to the
runner factory; relative paths and command names are rejected.

Do not paste a token into a remote URL, CLI argument, configuration file, or
bug report. If Git output includes an authorization header or URL user-info,
Shipyard redacts it before returning an error; operators should still revoke a
token that may have reached an external log.

REST resolver failures intentionally return a generic credential-resolution
error instead of forwarding resolver diagnostics. HTTP, transport, client
factory, and actor-verification failures redact the exact resolved credential
value, including values that do not look like conventional GitHub tokens.

## Private synthetic fixture

The private GitHub fixture is opt-in and must use an approved disposable
development repository and a least-privileged test credential supplied by the
operator's credential store. It is not part of the deterministic test suite.
It has no `NativeInteractive` configuration path and must not make a real
GitHub call unless an operator explicitly performs the approved fixture run.
Before and after a fixture run, an operator may inspect `gh auth status`; the
fixture must not switch or otherwise mutate its active account. Never record
the credential, raw command environment, or a remote containing credentials in
fixture evidence.
