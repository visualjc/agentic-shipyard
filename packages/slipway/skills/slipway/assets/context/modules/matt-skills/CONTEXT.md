# Matt skills context

Apply this module only after Slipway confirms the selected Matt Pocock skills
are installed and readable. Do not assume Repo A users or arbitrary Repo-B
sessions have them.

When `setup-matt-pocock-skills` produces a confirmed project draft, persist the
private instructions and supporting metadata in this module on the ledger.
Never write that output to tracked `AGENTS.md`, `CLAUDE.md`, or delivery cargo.

Default project conventions:

- Local Markdown issues and specs live under `.scratch/<feature-slug>/`.
- Triage uses `needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, and `wontfix`.
- Read the root domain context and relevant `docs/adr/` records before broad
  exploration.
