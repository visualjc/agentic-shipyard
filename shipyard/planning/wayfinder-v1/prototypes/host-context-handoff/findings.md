# Host context-handoff prototype findings

Date: 2026-08-03  
Result: 10 assertions passed

## Decision

Shipyard v1 can proceed with Codex as its proven live host. Claude Code and
Cursor/Pstack live dispatch are deferred until work intentionally enters the
Just Games environment; neither host received prototype context.

The smallest useful adapter interface is:

```text
{ host, role, envelopePath, repoRoot }
```

The envelope itself pins the product SHA, ledger SHA, role, and exact ledger
records the role may load. The worker verifies the product SHA before its first
`git show` of ledger content.

## Evidence

- Three separate ephemeral Codex processes discovered the project-local
  `shipyard-handoff` skill and loaded explicit implementer, reviewer, and status
  envelopes.
- Implementer received only contract and task records.
- Reviewer received only contract, acceptance evidence, and independent-review
  records; it did not receive the implementation-only canary.
- Status received no delivery records.
- A stale envelope exited with code 42 before loading any ledger record.
- Skills and envelopes were machine-local exclusions, leaving the synthetic
  product branch clean.
- The maintained CCPM source was fetched and verified at commit
  `cdb97474904ab2cdc7d391aa17393b444a28be3e`.

## Important boundary

This proves explicit context transfer through independent Codex invocations. It
does not prove implicit child-agent context inheritance, live Claude/CCPM
orchestration, or Cursor/Pstack dispatch. Those behaviors must not be claimed
from this prototype and remain future Just Games validation work.

## Reproduce

```sh
node prototype.mjs --exercise
```

The exercise uses only synthetic local Git history and removes its temporary
lab on completion.
