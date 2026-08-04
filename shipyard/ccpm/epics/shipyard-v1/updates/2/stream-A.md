---
issue: 2
stream: A — Package and pure core contracts
started: 2026-08-04T02:59:05Z
status: completed
---

## Scope

Own `package.json`, `tsconfig.json`, `src/index.ts`, `src/contracts/**`,
`src/status/**`, and their unit tests. Establish the ESM/public-contract
boundary only; do not implement binding, locks, CLI commands, or skills.

## Progress

- Implemented and verified at 2026-08-04T03:03:31Z.
- Added the Node 22 TypeScript ESM package boundary. The only dependencies are
  exact-pinned build-time `typescript@5.7.3` and `@types/node@22.10.2`; runtime
  validation is intentionally dependency-free to keep durable schemas portable.
- Public export inventory: `CONTRACT_VERSION`, `DELIVERY_PHASES`, `OPERATIONS`;
  profile/binding/path-policy/operation/lifecycle types and validators;
  `ContractValidationError`; and `createStatusProjection`/`composeStatus` plus
  their status extension types.
- Files changed: `package.json`, `package-lock.json`, `tsconfig.json`,
  `src/index.ts`, `src/contracts/{errors,types,validate}.ts`,
  `src/status/projection.ts`, `test/contracts/validate.test.ts`, and
  `test/status/projection.test.ts`.
- Verification: `npm run typecheck` passed; `npm test` passed (8 Node built-in
  tests, 0 failures).
- Product commit: `4f44aa8eab87c051323cc0880f5431b0bda8b08d`
  (`Issue #2: establish package and core contracts`).
- Reconciled with Stream B at `2026-08-04T03:08:01Z`: profile/binding topology
  repositories now require a validated named remote plus URL, and staged-pair
  remotes must be distinct. Re-exported only Stream B's documented adapter,
  binding, path-classification, and mutation-lock interfaces from the package
  root (classifier policy types are aliases to avoid collision with the durable
  versioned policy schema). The standard test command discovers all compiled
  `*.test.js` files.
- Reconciliation verification: `npm run typecheck` passed; `npm test` passed
  (16 tests, 0 failures: 9 Stream A and 7 Stream B).
- Terra-high distribution finding remediated at `2026-08-04T03:20:13Z`:
  `exports` previously targeted unpacked `dist`, no package `bin` mappings
  existed, and all four launchers were mode `0644`. Added a production file
  allowlist, `prepack` build, four explicit command mappings, executable
  launcher modes, and an A-owned packed-manifest regression test. Launcher
  content was not edited.
- Distribution evidence: `npm ci`, `npm run build`, `npm run typecheck`, and
  `npm test` passed (21 tests, 0 failures). A clean-dist
  `npm pack --dry-run --json` rebuilt through `prepack` and reported 67 entries,
  15,064 packed bytes / 51,881 unpacked bytes; `dist/src/index.js`, all four
  command targets, four skills, their focused references, and focused docs are
  present. All launchers report packed mode `493` (`0755`); `src/`, `test/`,
  and `dist/test/` are absent.
- Distribution remediation commit:
  `25a2871de67025c0ef6216a59460a2a44106787e`
  (`Issue #2: make the package installable`).
- Hardened-export alignment completed at `2026-08-04T03:23:25Z` against
  Stream B commit `5f45480976131379e38014ed32a19c2c11d241b4`:
  `ExclusiveDirectoryResult` is intentionally public, redundant classifier
  aliases were removed, and the canonical `PathOwner`/`PathPolicy`/`PathRule`
  contract names remain exported exactly once. `npm run typecheck` passed;
  `npm test` passed (26 tests, 0 failures).
- Hardened-export alignment commit:
  `582ae57b4afc1ea1536800a7821b9a151bfdc996`
  (`Issue #2: align hardened public exports`).

## Coordination

- Sole owner of package/config and public exports.
- Contract/import inventory is ready for Stream B reconciliation and Stream C.
