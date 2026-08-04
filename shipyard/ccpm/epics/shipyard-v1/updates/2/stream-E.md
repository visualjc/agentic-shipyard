---
issue: 2
stream: E — Profile authority and official Codex discovery correction
started: 2026-08-04T04:00:00Z
completed: 2026-08-04T04:00:00Z
status: implemented-awaiting-commit
---

## Finding dispositions

- The `BindingService` port now canonically validates every untrusted store
  document read, every bind candidate, and every document passed to write.
  Alternate conforming stores cannot persist or resolve empty names, malformed
  timestamps, unknown fields, incomplete topology, or invalid fingerprints.
- Canonical profiles now require a profile-owned `pathPolicy`. Bindings persist
  a lowercase SHA-256 profile fingerprint. The documented v1 input is a stable
  UTF-8 JSON projection containing the algorithm/version, schema/name, actor,
  named-URL topology, allowed operations, and path policy. Status recomputes it
  and requires explicit rebind on every authority change.
- Path classification has a profile-authorized entry point; it validates and
  uses `profile.pathPolicy`, not an unrelated operational policy.
- The only physical skill definitions remain `skills/<name>`. Repository
  discovery is `.agents/skills/<name>` symlinks to those canonical packages;
  each package contains `agents/openai.yaml`. The packaged artifact contains
  canonical skills, metadata, and user-installation documentation.

## Verification

- `npm ci`, build, typecheck, and full `npm test` passed: 38 tests, 0 failures.
- `npm pack`, a clean-prefix install, and installed `shipyard-help setup`
  succeeded.
- Discovery tests prove exact `.agents/skills` symlink targets, metadata,
  resolution without duplicate definitions, and a simulated
  `$HOME/.agents/skills` layout.
