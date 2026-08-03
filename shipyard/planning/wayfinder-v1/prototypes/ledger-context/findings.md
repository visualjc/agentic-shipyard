# Findings: ledger checkpointing and context resolution

Status: complete  
Executed: 2026-08-03  
Prototype: [`prototype.mjs`](prototype.mjs)

## Verdict

A deterministic resolver plus a small machine-local delivery registry is
sufficient for Shipyard v1. A persistent autonomous broker is not required.

The synthetic Git exercise passed 16 assertions. A binding keyed by Git's
shared common directory let a linked feature worktree infer exactly one
delivery. A main clone with two active deliveries failed as ambiguous until an
explicit delivery ID was supplied. The result was the same on every invocation;
no conversational memory or resident agent state participated.

## Checkpoint transaction

Two delivery writers prepared changes against the same ledger SHA. Writer A
committed first. Writer B's expected-head comparison rejected its stale write,
then a deterministic retry against A's new SHA committed B without losing A's
records. A short exclusive lock kept the actual working-tree mutation atomic.

Production should preserve the same transaction boundary:

1. resolve and pin the current ledger ref;
2. acquire the short repository ledger lock;
3. compare the current ref with the expected SHA;
4. apply one delivery's record changes;
5. commit and update the ref atomically;
6. release the lock; and
7. on a stale-head result, re-read, detect same-path conflicts, and retry rather
   than overwriting.

This is ordinary optimistic concurrency. A queue or background broker would add
state without solving a problem observed by the prototype.

## Context envelope

Each envelope pinned both the exact product SHA and exact ledger SHA, then named
only the records required by its role:

| Role | Prototype record set |
| --- | --- |
| Planner | premise, PRD, specification |
| Implementer | specification, task, acceptance contract |
| Reviewer | premise, specification, acceptance evidence, review record |
| Promoter | acceptance evidence, review record, promotion record, SHA linkage |

The agent-facing loader read records using `git show <ledger-sha>:<path>` while
the product clone remained on `main`; it never switched the product worktree to
the ledger branch. The reviewer did not receive implementation chatter, and the
implementer did not receive review or promotion records.

After a new product commit, the old envelope failed freshness validation. A new
ledger checkpoint created a new cross-linked envelope. The old envelope still
reproduced its original records from the old ledger SHA, which is necessary for
later audit.

Ticket 15 must still prove that each real host passes this envelope to workers
and reviewers without broadening it. The record-to-role table is a viable
starting contract, not a claim about host propagation.

## Metadata and archive result

Both product feature branches contained only product files. All PRD, spec,
acceptance, review, promotion, and linkage records lived on the parallel orphan
ledger branch. Finalization committed an archive record, created an annotated
development-only tag at the reviewed product SHA, deleted the feature branch,
and retained the ledger and tag.

A ledger commit cannot contain its own resulting SHA. The final record should
therefore name the previous ledger checkpoint and all product/destination SHAs;
the updated ledger ref, context envelope, or a later seal receipt records the
final ledger SHA.

## Remaining implementation cautions

- The prototype deliberately interleaved two stale writers but did not simulate
  a process dying midway through a filesystem write. Production still needs
  verified stale-lock recovery and idempotent retry.
- Same-path changes from two deliveries must be reported as a semantic ledger
  conflict rather than mechanically merged.
- The delivery registry is machine-local operational state. Durable intent and
  evidence remain in Git on the ledger branch.
- Resolver results must be recomputed at every operational boundary; callers
  must not treat a previously resolved mutable object as authority.

