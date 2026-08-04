# GitHub tracking recovery

GitHub tracking and Git transport are resumable only from safe, credential-free
state. A failed authenticated Git command reports a redacted diagnostic and
does not save its transport credential. Re-run the operation only after the
operator has confirmed that the configured credential store can resolve the
intended scoped credential and that the named remote remains credential-free.

If an operation was interrupted, do not recover by adding a token to a remote
or by changing the global `gh` account. Re-establish the normal credential
resolver, keep the same bound profile and repository identity, and use the
future tracker checkpoint/record discovery flow to determine whether a provider
write already completed. An ambiguous or mismatched provider record is unsafe
to repeat and requires manual review.

Tracking resolves the active binding and its fingerprint-matched named profile
*inside* the durable mutation guard. The caller supplies a local repository
path and injectable credential/network seams, never an actor login, PR ref,
SHA, or target topology. The active delivery workspace supplies the canonical
`shipyard/<delivery-id>` head, its exact worktree SHA, and the bound
development repository default branch. Returned PR heads must name that same
development repository; fork-qualified or noncanonical refs stop before a
repeat. The guard is a common-directory/delivery-keyed durable lock, so a
tracker flow first holds the shared workspace lifecycle lock, then its
delivery-keyed lock, so cleanup cannot race discovery or creation. It rereads
the complete delivery/worktree authority immediately before each provider POST.
If profile, fingerprint, topology, workspace, or head changed while waiting to
resume, Shipyard stops before the first provider request; do not recover by
substituting caller input.

The public tracker validates and snapshots its complete request before taking
that guard or resolving authority. Issue and pull-request inputs must be exact
objects with non-whitespace string titles and bodies. Optional resume state may
contain only canonical non-empty string issue and pull-request IDs. Malformed,
extra, or non-string fields fail with a stable local error before any provider
request, including actor verification.

Authenticated Git sync uses the active bound development repository only. It
derives the configured remote name and exact URL from the live profile/binding,
then rechecks the raw local remote immediately before launching Git. A changed,
destination, normalized, or caller-selected alternate remote blocks before a
credentialed child process starts.

## Private disposable tracker fixture

The executable private fixture is skipped unless
`SHIPYARD_PRIVATE_GITHUB_FIXTURE=1`. It requires exact matching
`SHIPYARD_PRIVATE_GITHUB_REPOSITORY` and
`SHIPYARD_PRIVATE_GITHUB_APPROVED_REPOSITORY`, the acknowledgement
`SHIPYARD_PRIVATE_GITHUB_MUTATION_ACKNOWLEDGEMENT=I_ACKNOWLEDGE_DISPOSABLE_GITHUB_MUTATIONS`,
token, expected actor, existing head ref, base ref, and canonical lowercase
40- or 64-hex head SHA.
`NativeInteractive/*` is always rejected. The approved disposable repository
must already contain that head branch at that SHA. In its controlled serial
run, the fixture creates one marked development issue/PR through
`trackDevelopmentRecords`, proves the second call discovers the same provider
IDs, then closes both records in `finally`; normal tests remain network-free.

The tracker identifies its records only by its exact marker on a standalone
body line. It excludes pull requests from GitHub's `/issues` listing and stores
GitHub's stable provider node ID when available, so a resumed run cannot mistake
a marked pull request or a marker-like body substring for its issue. Before
accepting either a discovered or newly-created pull request, it also verifies
the exact head SHA, head ref, and base ref requested for the delivery.

The common-directory/delivery lock serializes cooperating processes that share
that directory. It cannot serialize independent clones or hosts, and GitHub's
issue and pull-request create endpoints provide no documented compare-and-set
or idempotency-key guarantee. Shipyard therefore makes no global exactly-once
creation promise. After every POST it re-discovers the marker and returns
success only when the exact created record is visible and unique. If discovery
is delayed, mismatched, or finds duplicates, it fails closed rather than
claiming success. Wait for provider visibility, re-run discovery with the same
delivery ID, and manually reconcile duplicate marked records before retrying;
do not remove markers or create replacement records automatically.

For authorization failures, verify credential scope and the configured actor
outside Shipyard, then retry with a newly resolved ephemeral credential. For
transport failures, preserve only the sanitized error and the non-secret Git
operation details in a support record. Revoke and replace a credential if it
was exposed outside this boundary.
