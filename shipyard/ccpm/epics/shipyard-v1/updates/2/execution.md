---
issue: 2
updated: 2026-08-04T04:15:39Z
status: completed
progress: 100%
---

Stream D integrated the second Terra-high gate findings: canonical binding
persistence, profile-reader dependency inversion, deterministic shared-home
locking, and read-only status profile revalidation.

Stream E applied the third Terra-high correction: port-level canonical binding
validation, profile fingerprint authority pinning (including actor, operations,
topology, and profile-owned path policy), and the official Codex
`.agents/skills` symlink discovery layout with packaged `agents/openai.yaml`
metadata and safe user-installation guidance. Verification is recorded in
`stream-E.md`; independent review remains required on the exact final SHA.

Stream F corrected the lifecycle guard so a crash cannot leave an opaque,
permanent `.lifecycle` directory: it now has a versioned owner record and a
serialized same-host dead-process recovery protocol. It also rejects duplicate
binding common-directory identities at the canonical document boundary and
ships a deterministic installer for npm-installed canonical skills. Verification
is recorded in `stream-F.md`; independent review remains required on the exact
final SHA.

Stream G closes the remaining narrow safety findings: explicit valueless
installer arguments cannot select cwd, core modules no longer load the public
adapter-exporting barrel, and primary/lifecycle lock records are exactly
validated before recovery. Verification is recorded in `stream-G.md`;
independent review remains required on the exact final SHA.

## Completion

Exact-SHA verification completed for
`bba2e5e083ea460deba92ffa686b986b8102067f` against base
`7bfe2565d9ef2bc1af6f5caacc298aa32e5efbaa`: typecheck passed, all 46 tests
passed, diff check passed, and packed clean-install CLI verification passed.
See `../../evidence/issue-2-bba2e5e.md` and
`../../reviews/issue-2-bba2e5e.md`.
