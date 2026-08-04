# Ledger transport boundary

The isolated ledger ref (`refs/heads/shipyard-ledger`) is never product
transport. `GitLedgerStore.requireProductOnlyTransport(refspecs, payload)` is
the mandatory fail-closed boundary: it rejects a refspec that can read or write
that ref and rejects a serialized payload naming it.

There is intentionally no promotion implementation in this issue. Issue #7
must call this boundary immediately before its Git transport invocation.

Ledger and local workspace Git operations pin the same canonical, absolute Git
executable as the authenticated transport runner. A PATH-prepended executable
therefore cannot take control of a ledger update or worktree mutation. Their
children also use the shared minimal environment, clearing developer-tool
selection and system/global Git configuration before invoking the platform Git.

`GitLedgerStore` and `nodeWorkspaceGit` do not resolve the default Git path at
module import time. On a portable or minimal host, construct the explicit
factories `createGitLedgerStore(repositoryPath, executable)` and
`createNodeWorkspaceGit(executable)` with a reviewed absolute Git path. A
missing default is reported only when the first default-backed operation runs.
