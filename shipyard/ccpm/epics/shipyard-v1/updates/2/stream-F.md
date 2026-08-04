---
issue: 2
stream: F — lifecycle recovery and packaged skill installation correction
started: 2026-08-04T05:00:00Z
completed: 2026-08-04T05:10:00Z
status: implemented-awaiting-commit
---

## Finding dispositions

- Lifecycle guards now retain `owner.json` with version, host, PID, random
  token, and acquisition timestamp. Recovery is serialized inside the durable
  guard and removes a guard only after a same-host owner is proven dead. Live,
  cross-host, malformed, and changed ownership fail closed with actionable
  guidance; empty crash remnants are reclaimed with empty-directory removal.
- Canonical binding-document validation rejects duplicate `commonDirectory`
  identities before any service resolution or store write.
- npm packages ship canonical `skills/*`, not source-checkout `.agents`
  symlinks. `shipyard-skills-install --target PROJECT_ROOT` and
  `--home HOME_ROOT` verify all four packages and metadata before atomically
  creating only absent exact-target discovery symlinks; existing files,
  directories, and wrong symlinks are refused.

## Verification

- `npm run typecheck` and the full `npm test` suite passed: 43 tests, 0
  failures.
- Distribution tests pack and clean-install the tarball, invoke the installed
  installer for simulated project and home roots, verify each `SKILL.md` and
  `agents/openai.yaml`, prove idempotence, and prove refusal to overwrite.
- Lifecycle tests cover empty/dead/live/cross-host/corrupt guards, serialized
  competing recovery, replacement survival, and release/acquisition crash
  boundaries.
