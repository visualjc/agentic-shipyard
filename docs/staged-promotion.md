# Staged-pair promotion

Staged promotion moves reviewed product cargo from the private development repository into a normal branch and pull request owned by the destination repository. It does not create a fork PR, destination issue, merge, or copy Shipyard records.

## Preconditions

The trusted operation resolves the delivery, binding, staged-pair profile, actor, current product SHA, acceptance evidence, and independent review itself. The development worktree must be clean and checked out at that exact reviewed SHA. The SHA must descend from the current destination `main`; a revision must also descend from the prior reviewed development SHA. Every source and destination path must have exactly one current profile owner.

The development clone must not retain the destination GitHub URL as a push URL. Authenticated destination Git runs only in a temporary bare repository with an ephemeral credential verified for the bound actor.

## Product projection

Shipyard constructs the destination tree through Git's index and object database. It replaces destination paths owned as `product` with the reviewed development product projection and retains the destination baseline paths owned as `destination-only`. Development records, generated files, context overlays, scratch data, and prohibited `.shipyard`, graph, CCPM, host, credential, and ledger metadata cannot enter the payload.

Blob IDs and modes are preserved, including regular and executable files, symlinks, binary blobs, deletions, renames as their resulting tree operations, unusual normalized paths, and allowed gitlinks. The written commit tree must exactly equal the policy-owned projection.

## Initial promotion and revisions

The first destination commit has the observed destination `main` as its parent. Shipyard publishes it with an ordinary non-force push to `shipyard/<delivery-id>` and reconciles one marked, destination-owned, same-repository PR.

Destination feedback returns to the development branch. After renewed acceptance and independent review at a new SHA, `appendRevision` computes one deterministic descendant destination commit whose parent is the last manifest mapping. It updates the existing PR dossier; it never amends or force-pushes an active branch.

The development-only promotion manifest maps every reviewed development SHA to its exact destination parent, commit, tree, projection/policy digest, and frozen evidence/review receipt. The append-only journal records external steps. A retry adopts an already-published commit only when rebuilding the deterministic commit produces the exact same object ID; any other branch movement stops for human inspection.

The operation ends in `awaiting-human-merge`. Only a human or the destination team's ordinary policy may merge the PR.
