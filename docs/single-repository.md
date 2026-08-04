# Single-repository certification and finalization

A `single-repository` profile uses one repository and its one existing delivery pull request. Shipyard certifies that pull request; it never creates a second pull request, a fork pull request, or a cross-repository handoff.

## Certification boundary

The caller supplies only the delivery ID. Under the repository mutation lock, Shipyard derives the current binding, named profile, command-scoped actor, registered `shipyard/<delivery-id>` worktree, repository, branch, existing marked pull request, exact local head/tree, path policy, and trusted acceptance/review receipt.

Certification requires all of these facts to agree:

- the marked pull request is unique, open, and belongs to the bound repository for both head and base;
- its head ref is the registered delivery branch, its base is the configured default branch, and its head SHA equals the current accepted and independently reviewed product SHA;
- the clean checked-out delivery worktree and branch name that same SHA;
- every tree path has exactly one `product` owner; `development-record`, `development-generated`, `destination-only`, context, and scratch owners are non-publishable in this no-projection topology, while the shared `.git`, `.shipyard`, `.graphs`, `.ccpm`, `.codex`, `.claude`, `.cursor`, and `shipyard-ledger` roots are prohibited regardless of profile classification; and
- the evidence, tree, policy, PR identity, base, actor, profile, and binding remain exact immediately before each provider mutation.

Shipyard durably records the certification intent before it updates the bounded review dossier or marks a draft ready. Those are separate idempotent provider steps with exact post-write reconciliation. The provider capability has no method to create, retarget, replace, fork, close, or merge a pull request.

A changed head requires renewed exact-SHA acceptance and independent review, then appends a new certification revision for the same PR identity. A stale, replaced, retargeted, forked, wrong-head, ambiguous, closed-unmerged, or already-merged PR blocks certification.

## Human merge and finalization

The repository's normal human/team policy performs the merge. Shipyard begins finalization only after it observes the exact certified PR as merged and verifies the configured merge policy:

- `merge-commit` requires the certified head in a real merge commit's ancestry;
- `squash` and `rebase` require the observed merge tree to equal the certified head tree; and
- every policy requires the recorded merge to be reachable from the pinned current `main`.

Finalization freezes an immutable intent, then performs only these checkpointed effects:

1. publish or verify the annotated `shipyard/reviewed/<delivery-id>` tag at the certified head;
2. fast-forward the exact clean checked-out local `main` to the already-merged remote `main` through the shared under-lock compare-and-swap seam;
3. close the exact tracked issue only when it was present in the certification manifest;
4. durably record local-workspace cleanup started, remove only the registry-owned clean local worktree/branch with ref-CAS proof, durably record cleanup completed, then durably record delivery-branch deletion intent;
5. delete the exact delivery branch with force-with-lease recovery deletion;
6. record the complete manifest, receipt, and append-only journal; then
7. seal the complete delivery ledger last and publish that seal on the isolated `shipyard-ledger` ref.

There is one delivery branch, so staged-pair-only destination-branch and development-PR cleanup is not emulated. The existing PR remains the externally merged PR.

## Test boundary

Issue #8 uses deterministic fake-provider and disposable local Git fixtures. Authenticated execution against a private synthetic GitHub repository is not authorized and is skipped. A future live probe requires a separate reviewed, code-owned repository/actor allowlist; no prior private fixture or Just Games resource may be used.
