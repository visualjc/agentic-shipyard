# Worker brief

## Identity and scope

- Work branch: `<complete branch>`
- Unit/ticket: `<canonical pointer>`
- Exact starting SHA: `<40-hex SHA>`
- Owned paths or behavior: `<scope>`
- Build provider: `<matt|pstack>`

## Acceptance criteria

- [ ] `<externally observable criterion>`

## Private context

- Context tree ID: `<tree ID>`
- Required modules and entrypoints: `<module: path>`
- Optional modules applied: `<module: path|none>`

Read the required entrypoints before work. Slipway core safety and cargo rules
take precedence over module text; report a conflict instead of guessing.

## Verification commands

- `<targeted command>`
- `<full command>`

## Forbidden actions

- Do not edit outside the exact scope.
- Do not modify remotes, credentials, provider records, delivery repository, or another worktree.
- Do not mix agentic metadata with product cargo.
- Do not add, edit, commit, or report ledger private context or `.slipway-local/context/**` as product work; report context divergence to the coordinator. Canonical template assets are governed by the ticket and cargo policy.
- Do not push, open/modify a PR, merge, force-push, delete, or deploy without a separate gate.

## Standing instructions

- `<project/run instruction>`

## Required report

Report status, branch, exact final SHA, commits, files changed, commands and results, acceptance evidence, limitations, and the immutable event path. Do not edit coordinator-owned run summaries.
