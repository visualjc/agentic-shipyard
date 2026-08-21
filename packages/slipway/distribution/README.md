# Install Slipway

`packages/slipway/skills/` is the canonical source. Install all eight directories as one suite; do not track project-root discovery links or generated host directories.

The eight directories cannot be replaced with one filesystem rename because they share a host root with unrelated skills. Treat installation as a coordinated transaction: stage and validate the complete suite, close active host sessions, activate all eight, verify, and roll back the entire suite if any activation step fails. “Atomic” below means no host session is allowed to observe or use a partial or mixed-version suite; it is not a claim that eight directory replacements are one filesystem operation.

## Suite

- `slipway`
- `slipway-setup`
- `slipway-status`
- `slipway-resume`
- `slipway-review`
- `slipway-sync`
- `slipway-promote`
- `slipway-finalize`

Copy whole skill directories so their playbooks, references, assets, and `agents/openai.yaml` metadata remain together.

## Prerequisite source and capability catalog

Slipway's planning, implementation, diagnosis, and review baseline comes from the official [mattpocock/skills](https://github.com/mattpocock/skills) repository. Its canonical capability catalog is:

- `setup-matt-pocock-skills`
- `wayfinder`
- `grill-with-docs`
- `to-spec`
- `to-tickets`
- `implement`
- `tdd`
- `code-review`
- `diagnosing-bugs`
- `triage`
- `research`
- `prototype`

For Codex and other Agent Skills hosts, the upstream installation command is:

```bash
npx skills@latest add mattpocock/skills --global
```

Select the capabilities needed for the intended lanes and ensure `setup-matt-pocock-skills` is included before project setup. Verify each selected skill at `~/.agents/skills/<name>/SKILL.md`. Record the resolved upstream commit or installer version, installed paths, and canonical names during preflight; do not assume a similarly named skill is sufficient.

Missing capabilities do not block Slipway installation, status, resume, or unrelated lanes. Setup blocks only when `setup-matt-pocock-skills` is missing. Each delivery lane blocks immediately before the first action that needs one of its catalog capabilities; `research`, `prototype`, and `triage` are required only when that route selects them.

For a paired project, setup confirms private context and cargo policy without
creating a tracked public bootstrap. It seeds the ledger-owned context registry
and caches it only under ignored Repo-B local state. Matt setup drafts are
redirected into the private `matt-skills` module, never tracked `AGENTS.md` or
`CLAUDE.md`. Invoking Slipway loads the selected modules; arbitrary host
sessions are intentionally outside that guarantee.

Existing paired projects that still use `.slipway/agent-overlay/` must run the
confirmed `$slipway-setup` migration before their next lane or delivery gate.
The migration preserves legacy policy until the new context cache and active
run module records are verified; it never adds a tracked host adapter.

For Claude Code, the same upstream is available as the official `mattpocock-skills` plugin or through the Agent Skills installer. Choose one Matt installation mechanism for that host; installing both creates duplicates. Slipway itself is still installed separately as described below.

The required `code-review` capability is specifically Matt's `skills/engineering/code-review/SKILL.md` with frontmatter name `code-review`. A host built-in `/code-review`, `intent-pr-review`, `pr-change-walkthrough`, or another similarly named reviewer does not satisfy the delivery gate unless the user explicitly changes the configured capability after comparing its contract.

## Sources

Use one exact source at a time:

- Stable: `slipway-deploy/main` at a verified exact SHA.
- Development: an explicitly selected agentic worktree at a verified branch and exact reviewed SHA.

Report the selected source path, branch, and SHA before installation. A development install replaces the stable suite; it does not create a second named copy.

## Preflight

Before copying:

1. Inventory the Matt catalog capabilities above and their source. Require `setup-matt-pocock-skills` for setup and only the selected lane's capabilities before that lane; report other missing capabilities without blocking Slipway installation, status, or resume.
2. Verify every Slipway suite directory exists and contains a readable `SKILL.md`.
3. Inspect the destination for all eight Slipway names. If any exists, compare it with the selected source and require confirmation before replacement.
4. Check `~/.cursor/skills/` for `slipway*`. Stop on a duplicate; Cursor consumes the universal installation and must not receive another copy there.
5. Preserve every unrelated skill and host configuration.
6. Close Cursor, Codex CLI sessions, and any other host that could discover the destination during activation.

## Agent Skills hosts

Install the complete suite into `~/.agents/skills/`. This is the single installation used by Cursor IDE, Cursor CLI, Codex, and compatible Agent Skills hosts.

For a new installation, update, or source switch:

1. Create a timestamped staging directory outside the target root and copy all eight source directories into it.
2. Run the skill validator against every staged directory and confirm that the staged names exactly match the suite list.
3. If replacing an installation, require the previously requested confirmation and move all eight installed directories to a timestamped backup outside the target root. Do not touch unrelated entries.
4. Move the eight validated staged directories into the target root without starting a host between moves.
5. Confirm all eight installed directories match the selected source, then start a fresh host session and perform the verification below.
6. If any activation or verification step fails, stop all hosts, move every newly activated Slipway directory back to the failed staging area, restore the complete backup when one exists, and report the failure. Keep both backup and failed staging data until the user accepts the result.

This procedure makes the suite replacement atomic from the host's perspective: a host is either using the previous complete suite or starts fresh with the new complete suite.

Do not also copy Slipway into `~/.cursor/skills/`.

## Claude Code

When Claude Code support is wanted, install the same complete suite separately into `~/.claude/skills/`. Apply the same closed-host staging, backup, activation, rollback, and validation rules. This copy is intentional because Claude Code has its own global skill root.

## Verify

Start a fresh host session and verify:

1. All eight canonical names are discoverable exactly once.
2. “Use Slipway” selects the primary coordinator.
3. Explicit `/slipway` or the host's equivalent syntax loads the primary coordinator.
4. Each direct command loads the same canonical suite and can resolve the primary skill's playbooks, references, and assets.
5. Capability preflight finds the required Matt skills and reports pstack only as an optional provider.

## Restore, update, and uninstall

- Restore stable mode by reinstalling from verified `slipway-deploy/main`.
- Update by repeating preflight and replacing all eight directories atomically as one version.
- Uninstall only the eight names listed above, after explicit confirmation. Never remove unrelated skills or global host configuration.

V1 has no installer script, tracked build output, or Cursor plugin manifest. Add host-specific packaging only when a host requires transformed artifacts or repeated installation failures justify automation.
