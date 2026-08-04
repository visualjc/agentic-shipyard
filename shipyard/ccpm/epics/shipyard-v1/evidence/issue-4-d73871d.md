---
issue: 4
product_sha: d73871ddd275e8915141dcc5a5283e1d1542da96
base_sha: bba2e5e083ea460deba92ffa686b986b8102067f
verified_at: 2026-08-04T09:40:26Z
verifier_model: gpt-5.6-terra
verifier_effort: high
result: implementation-pass-external-fixture-pending
---

# Issue #4 deterministic acceptance evidence

This record approves the deterministic implementation at exact product SHA
`d73871ddd275e8915141dcc5a5283e1d1542da96`. It does **not** claim that the
opt-in live private GitHub fixture ran. The code-owned approval allowlist is
intentionally empty, so no live repository is authorized in this revision.

## Verification commands and results

| Command | Result |
| --- | --- |
| `git rev-parse HEAD` | Exact SHA confirmed. |
| `git diff --check bba2e5e... d73871d...` | PASS. |
| `npm run typecheck` | PASS. |
| `npm test` | PASS; 209 passed, 0 failed, 1 live fixture skipped. |
| `npm pack --dry-run --json` | PASS; 141 packaged entries. |
| private fixture focused suite | PASS; seven deterministic cases passed and the live case skipped. |

## Acceptance criteria

| Criterion | Result | Exact-SHA evidence |
| --- | --- | --- |
| Verify configured actor before mutation | PASS | REST authority/tracker tests order `/user` before writes and prove wrong/missing/denied credentials make zero writes. |
| Preserve global GitHub CLI account | PASS | Production adapter and transport do not invoke `gh`; command-contract tests prohibit account switching. |
| Ephemeral authenticated Git with inherited helpers disabled and redaction | PASS | Transport tests cover sanitized child environment, empty credential helper, no token in argv/URL/output/error, pinned executable, and hostile Git config isolation. |
| Development-only issue/PR targeting | PASS | Bound topology selects only development; destination and `NativeInteractive` tracker mutations are rejected before transport. |
| Resumable, idempotent REST tracking | PASS | Exact marker/ID pagination, partial issue resume, duplicate ambiguity, checkpoint mismatch, head/base/SHA validation, and post-write reconciliation pass. |
| Stable provider checkpoint data | PASS | Checkpoints return stable ID, number, URL, marker, actor, state, and expected head SHA without taking ledger ownership. |
| PRD AC-003, AC-004, AC-007, provider AC-019 | PASS (deterministic) | Actor, transport, targeting, and resume matrices pass at the exact SHA. |

## Private-fixture safety and external gate

- Approval comes only from an exact reviewed code-owned `{repository, actor}`
  allowlist; environment, file, and path input cannot grant authority.
- The allowlist is empty. `visualjc/shipyard-fixture-staged` is explicitly
  forbidden by D-009, and every `NativeInteractive/*` repository is rejected.
- Authorization fails before token read, client binding, provider request, or
  local fixture state.
- For a future reviewed approval, actor and live branch/SHA are checked before
  setup and immediately before each POST. Cleanup can close only positive IDs
  observed from successful POST responses in that invocation; GET-discovered
  records are ineligible. Documentation truthfully records the remaining
  cross-request TOCTOU and no-response ambiguity.

## Definition of Done

| Requirement | Result | Evidence |
| --- | --- | --- |
| GitHub adapter interface | PASS | Scoped REST, actor, tracker, and Git transport seams are typed and package-bypass tests pass. |
| Unit, negative-auth, redaction, and private-fixture tests | **PENDING external gate** | Deterministic fixture harness tests pass; live private fixture is unauthorized and skipped. |
| Credential/tracker docs and recovery | PASS | Packaged docs describe scope, resume, cleanup, TOCTOU, and reviewed authorization. |
| Exact SHA and verifier | PASS | Recorded here. |
| Independent code review | PASS | See [issue-4-d73871d](../reviews/issue-4-d73871d.md). |

Issue #4 remains open until a newly approved disposable repository/actor is
added by reviewed code change and the live fixture evidence is recorded.
