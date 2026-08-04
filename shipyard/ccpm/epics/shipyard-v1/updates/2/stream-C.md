---
issue: 2
stream: C — Setup, read-only CLI, Codex skills, and focused docs
started: 2026-08-04T03:08:01Z
updated: 2026-08-04T03:27:27Z
status: reviewer-findings-remediated
---

## Scope and implementation

- Added dependency-free `shipyard`, `shipyard-setup`, `shipyard-status`, and
  `shipyard-help` launchers and command wiring, consuming binding/status APIs
  only through `src/index.ts` public exports.
- Setup validates a complete existing topology, uses Git common-directory
  identity, writes only the machine-local binding document, refuses implicit
  replacement, provisioning, and remote rewrites, and requires `--rebind`.
- Status resolves a binding and help prints focused guidance without provider
  writes or mutation locks. Binding failures map to deterministic setup/rebind
  remediation, including unbound, duplicate, stale, partial, and remote
  mismatch conditions.
- Added four Codex Agent Skill directories with invocation metadata and
  progressive operation-specific references; added focused setup/status/help
  and metadata-ownership docs and README entry points.

## Verification

- `npm run typecheck` passed at 2026-08-04T03:12:08Z.
- `npm test` passed: 20 Node built-in tests, 0 failures. New disposable-Git
  coverage verifies setup/rebind, remote mismatch/incomplete topology guidance,
  main/linked-worktree resolution, read-only status/help binding state, and
  skill discovery/reference metadata.
- `node bin/shipyard-help status` smoke test passed.
- Product commit: `fc4bc1a5930ea72ff3352a6a95c5e8bd01a213d6`
  (`Issue #2: add setup status and help workflow`).

## Terra-high finding dispositions

- Named profile identity: remediated. Setup loads
  `$SHIPYARD_HOME/profiles/<name>.json`, validates the canonical version 1
  `Profile`, requires filename/document-name agreement, requires `setup` in
  `allowedOperations`, and requires exact topology kind plus named remote/URL
  agreement before any binding write. It never creates a profile.
- Setup mutation locking: remediated. The setup transaction acquires the public
  hardened `MutationLockService` before binding read/write/rebind, using a
  SHA-256 lock filename derived deterministically from canonical Git common
  directory identity. Live contention and unsafe cross-host stale recovery fail
  with actionable guidance; the lock is ownership-checked on release.
- Repository identity guidance: remediated. Setup/status explicitly preflight
  Git common-directory identity and translate non-Git or unknown identity
  failures into `shipyard-setup` remediation rather than raw adapter text.
- Tests/docs: remediated with explicit staged-pair and single-repository profile
  fixtures, missing/malformed/name/topology mismatch cases, deterministic
  concurrent rebind exclusion, unsafe stale-lock recovery, non-Git guidance,
  and updated progressive setup references.
- Post-remediation verification at 2026-08-04T03:27:27Z: `npm run typecheck`
  passed; `npm test` passed 31 tests with 0 failures; focused setup help probe
  passed.
- Remediation commit: `e09ef41e13b0edc563a3269ea06beaba128e7f3a`
  (`Issue #2: harden setup identity and locking`). No acceptance evidence was
  created; renewed independent Terra-high verification remains required.

## Handoff

The remaining gate is renewed independent Terra-high review against the exact
integrated commit.
No Stream C change modifies package/config/public exports, binding/policy/lock
implementation, or adapters.
