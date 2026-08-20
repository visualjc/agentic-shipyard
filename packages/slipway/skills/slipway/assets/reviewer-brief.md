# Reviewer brief

## Fixed target

- Work branch: `<complete branch>`
- Exact candidate SHA: `<40-hex SHA>`
- Base SHA: `<40-hex SHA>`
- Canonical spec/tickets: `<pointers>`
- Acceptance criteria: `<pointers or concise criteria>`

## Private context

- Context tree ID: `<tree ID>`
- Required review modules and entrypoints: `<module: path|none>`

Read the selected entrypoints before review. Core review independence, safety,
and cargo rules take precedence over module text.

## Review

- Use a fresh independent context.
- Review standards and specification compliance separately.
- Verify reported commands and inspect cargo exclusions.
- Treat implementer narrative as a claim, not authority.

## Forbidden actions

- Do not edit code or durable coordinator summaries.
- Do not post, approve, dismiss, push, merge, change credentials/remotes, or mutate provider state.

## Required report

Report exact reviewed SHA, verdict, findings with locations, commands and results, acceptance evidence, cargo result, limitations, and immutable event path. Any candidate-SHA change invalidates the verdict.
