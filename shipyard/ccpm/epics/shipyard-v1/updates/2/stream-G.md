---
issue: 2
stream: G — narrow safety correction
started: 2026-08-04T05:10:00Z
completed: 2026-08-04T05:24:00Z
status: implemented-awaiting-commit
---

## Finding dispositions

- The packaged installer now rejects a missing, empty, or option-looking value
  for either `--target` or `--home` before root selection. Only the absence of
  both options uses the current directory; supplying both remains an explicit
  ambiguity error.
- Core command and CLI policy/store/runtime modules now import their owned
  contracts directly rather than importing the consumer-facing public barrel.
  The status dependency probe proves its static import graph has neither the
  Node Git adapter nor `node:child_process`.
- Primary mutation locks and lifecycle owner records now require exact
  version-1 keys, positive integer PIDs, non-empty identity fields, and
  canonical ISO timestamps before any recovery action. Malformed records fail
  `lock-invalid` and remain untouched.

## Verification

- `npm run typecheck` and `npm test` passed: 46 tests, 0 failures.
- The packed-tarball clean-install probe covers valueless target/home options,
  flag-as-value rejection, both-option ambiguity, no discovery-path creation,
  idempotence, and wrong-symlink refusal.
- Lock adversarial fixtures cover malformed JSON, zero/negative/fractional
  PIDs, empty required fields, noncanonical/invalid dates, and unknown fields
  for both primary and lifecycle records while retaining prior dead-owner and
  recovery-race coverage.
