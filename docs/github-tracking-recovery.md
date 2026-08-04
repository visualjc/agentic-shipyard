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

The tracker identifies its records only by its exact marker on a standalone
body line. It excludes pull requests from GitHub's `/issues` listing and stores
GitHub's stable provider node ID when available, so a resumed run cannot mistake
a marked pull request or a marker-like body substring for its issue. Before
accepting either a discovered or newly-created pull request, it also verifies
the exact head SHA, head ref, and base ref requested for the delivery.

For authorization failures, verify credential scope and the configured actor
outside Shipyard, then retry with a newly resolved ephemeral credential. For
transport failures, preserve only the sanitized error and the non-secret Git
operation details in a support record. Revoke and replace a credential if it
was exposed outside this boundary.
