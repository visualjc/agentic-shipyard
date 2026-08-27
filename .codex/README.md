# Slipway source-repository Codex tooling

This directory configures Codex only while working in the Slipway source
repository. Root configuration selects Sol/high. Codex 0.144.4 uses the
compatible `features.multi_agent = true` and legacy `agents.max_threads = 6`
form to enable multi-agent work with a six-thread ceiling; it cannot configure
an unnamed-agent model/effort default. Do not spawn unnamed/default delegated
agents on this client. The six standalone role files pin the requested models:
`context_gatherer` (Luna/low/read-only), `repo_knowledge`
(Luna/low/read-only), `planner` (Terra/medium/read-only), `developer`
(Terra/medium/workspace-write), `qa_tester` (Luna/high/workspace-write with no
source edits or rewriting formatters), and `reviewer` (Terra/high/read-only).
It is contributor tooling, not a Slipway skill, installer, or host-global
configuration.

The repository does not install, generate, hydrate, or require this directory
in an unrelated project. In particular, Slipway distribution stages only the
eight canonical directories under `packages/slipway/skills/`; it never copies
this directory or the root `AGENTS.md` into an installed suite.

Local or user-level Codex configuration can override these settings. The role
files make their intended model, reasoning effort, and sandbox explicit so a
reviewer can tell when an override changes the planned boundary.
