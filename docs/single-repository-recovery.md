# Single-repository recovery

Retry the same trusted certification or finalization operation with only its delivery ID. Do not edit the manifest, evidence pins, journal, finalization intent, receipt, reviewed tag, delivery branch, PR markers, or ledger ref to make a retry pass.

## Safe automatic recovery

- A dossier update succeeded but its response or journal append was interrupted: Shipyard re-observes the same PR, exact head/base/topology, and canonical dossier digest. It performs no second update when they match.
- Mark-ready succeeded but its response or journal append was interrupted: Shipyard re-observes the same exact PR as non-draft and records the missing checkpoint without creating another PR.
- Issue closure succeeded but its completion checkpoint was interrupted: the exact checkpointed issue identity may already be closed and is adopted without replacement.
- Branch deletion succeeded but its completion checkpoint was interrupted: absence is accepted only after the exact deletion-intent checkpoint is durable. Absence without that intent blocks.
- A reviewed tag, local-main synchronization, receipt, seal, or seal publication is already complete: Shipyard verifies the exact immutable state and continues without creating a different object.

## Manual inspection blockers

Stop when the marked PR is missing or ambiguous; its identity, repository, head, base, marker, dossier, or merge changed; it is closed without merge; the delivery branch moved, disappeared without deletion intent, or was recreated after deletion; acceptance/review or path policy is stale; the worktree is dirty or no longer registry-owned; `main` cannot fast-forward to the pinned merged commit; the tracked issue was replaced; the reviewed tag conflicts; or a ledger compare-and-swap/seal no longer matches.

Shipyard does not recover these states with a merge, rebase, reset, amend, active-branch force push, resource recreation, broad deletion, automatic merge, or global GitHub account switch. Preserve the external state and reconcile it explicitly before a renewed reviewed operation.

The live private synthetic fixture remains unauthorized and unexecuted. Deterministic fake-provider and disposable local Git results must not be described as a live GitHub run.
