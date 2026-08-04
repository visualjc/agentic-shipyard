---
issue: 2
stream: D — Terra-high integration correction
started: 2026-08-04T03:40:15Z
completed: 2026-08-04T03:40:15Z
status: implemented-awaiting-commit
---

## Finding dispositions

- **Split binding domain:** remediated. `BindingDocument` contains the exported
  canonical `Binding` contract verbatim and validates every persisted entry
  through `validateBinding` on reads and writes.
- **CLI dependency direction:** remediated. Core setup/status consume the
  narrow `ProfileReader` port and pure core profile policy; global filesystem
  profile storage remains an adapter wired at the CLI runtime boundary.
- **Cross-repository lost update:** remediated. Setup acquires the required
  repository lock, then `$SHIPYARD_HOME/locks/binding-store.lock`, and releases
  in reverse order. The deterministic concurrent fixture proves a retryable
  blocker rather than false success and retains both bindings after retry.
- **Status profile drift:** remediated. Every status operation reads the named
  profile, checks `status` authorization and exact topology before projection;
  it remains lock-free and read-only.

## Verification

- `npm ci`, build, typecheck, and full test suite passed: 33 tests, 0 failures.
- `npm pack` then clean-prefix install ran `shipyard-help status` successfully.
- Exact adversarial reproductions passed: cross-repository concurrent setup and
  status profile revalidation.
