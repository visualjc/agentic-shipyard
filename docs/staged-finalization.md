# Staged-pair finalization

Finalization observes a human/team merge and retires the private development workflow. Shipyard has no merge capability.

## Merge verification

Before its first mutation, Shipyard revalidates the bound actor/topology, final reviewed development SHA, acceptance/review receipt, path policy, product projection, destination branch/tree, normal same-repository PR identity, and unmerged development PR identity. A closed-unmerged, retargeted, replaced, forked, wrong-head, or ambiguous destination PR blocks.

The profile declares one merge policy:

- `merge-commit`: the recorded destination commit must be an ancestor of the observed merge commit, which must have at least two parents.
- `squash` or `rebase`: the observed merge commit tree must equal the final promoted destination tree.

In all policies, the provider's recorded merge commit must be reachable from the observed destination `main`. The PR head does not need to equal current `main` after merge; later destination commits are allowed as long as the exact merge remains in its ancestry.

## Durable intent and ordered effects

Shipyard freezes an immutable finalization intent before cleanup. It records the exact merge/main/product/manifest identities and the development records that may be closed. The merged destination PR checkpoint is retained in the promotion manifest.

Resumable effects then run under the shared mutation lock:

1. Publish or verify an annotated `shipyard/reviewed/<delivery-id>` tag in development only.
2. Fast-forward the exact clean checked-out development `main` to the observed destination `main`, using an under-lock compare-and-swap seam, then publish that ordinary fast-forward.
3. Close the exact development PR without merge and close the exact development issue.
4. Durably record deletion intent for the exact remote development delivery branch, delete it, then remove only the registry-owned clean local worktree/branch with ref CAS proof.
5. Durably record deletion intent for the exact destination delivery branch, then delete it after merge with a force-with-lease deletion. This lease is cleanup, never an active-branch history rewrite.
6. Record the complete manifest, final receipt, and append-only execution journal.
7. Seal the complete durable delivery record last and publish/verify that seal on the development-only ledger ref.

Each step first observes the exact expected identity and treats an already-completed exact state as success. Branch absence is accepted only after its exact deletion-intent checkpoint is durable, which makes a crash after remote deletion recoverable without treating unrelated absence as success. A changed tag, ref, PR, issue, worktree, main, actor, or policy stops rather than guessing. No ledger checkpoint is written after the final seal; publication of the already-created seal is the sole post-seal effect.
