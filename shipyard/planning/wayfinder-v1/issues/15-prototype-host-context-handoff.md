# Prototype host-specific context handoff

Type: prototype  
Status: resolved  
Blocked by: 13, 21

## Question

Can Shipyard pass one pinned delivery context envelope through Pstack in Cursor
and CCPM multi-agent execution in Claude Code and Codex while preserving role-
specific progressive loading and independent-review boundaries?

The prototype should prove that implementation subtasks receive the current
contract, review tasks receive intent and evidence without unnecessary
implementation chatter, stale envelopes are rejected after a product-SHA
change, and sync/status operations load no delivery records. It should identify
the smallest host adapter interface that avoids embedding host-specific behavior
in the generic workflow.

The answer should state any host whose reliable context propagation must be
experimental or deferred in v1.

## Comments

- Blocked until the deterministic ledger/context resolver and supported
  development-toolchain contract are defined.

## Answer

The Codex-only exercise passed 10 assertions. Separate ephemeral Codex
invocations discovered a project-local adapter skill and received explicit,
role-limited envelopes. Implementers loaded contract and task records;
reviewers loaded contract, acceptance evidence, and independent-review records
without implementation-only chatter; status loaded no delivery records. A
stale product SHA was rejected before the first ledger record load, and the
product branch remained clean.

The smallest adapter interface is `{host, role, envelopePath, repoRoot}`. The
envelope pins product SHA, ledger SHA, role, and exact record paths. Codex is the
only empirically supported live host for the current v1 boundary.

Claude Code and Cursor/Pstack were not invoked because both are authenticated
with Just Games identities. Live Claude/CCPM, Cursor/Pstack, and implicit
child-agent propagation are explicitly deferred until Just Games validation is
appropriate. See
[`../prototypes/host-context-handoff/findings.md`](../prototypes/host-context-handoff/findings.md).
