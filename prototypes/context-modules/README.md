# Focused private context-module proof

This disposable proof answers one question: can Slipway select and propagate
private declarative modules without adding any tracked bootstrap to the
application repository?

Run:

```sh
bash prototypes/context-modules/run.sh
```

The scenario intentionally covers only:

1. one happy path with `project-policy`, `matt-skills`, and `codegraph` active;
2. one worker brief carrying exact selected entrypoints and context tree ID;
3. one optional CodeGraph-capability skip; and
4. an unchanged tracked Repo-B tree with empty delivery cargo.

It does not test multiple agent hosts, every lane, object formats, fault
injection, or an exhaustive manifest matrix. Invoking Slipway is the accepted
bootstrap; arbitrary sessions are outside the guarantee.

## Fresh worker probe

On 2026-08-20, a fresh low-effort Cursor agent received only the generated
worker brief and its selected cached entrypoints. It made no edits and returned:

```text
Issue location: `.scratch/<feature-slug>/` (local Markdown issues/specs)

Exploration tool/order:
1. Read root domain context
2. Read relevant `docs/adr/` records
3. Use CodeGraph first (`.codegraph/` + MCP tool/`codegraph` command) for code discovery
4. Only then use grep/find/broad file reading as fallback
```

This is one propagation proof, not a host-compatibility claim.
