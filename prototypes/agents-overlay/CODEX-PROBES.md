# Codex host probes

**Prototype evidence only; not delivery cargo.** This records one reproducible
fresh-context Codex probe of the candidate branch's forced-status behavior. It
does not claim that `run.sh` launches Codex, and it does not validate Claude
Code or any other host.

## Probe 1: divergent local overlay during forced status

- Date: 2026-08-06
- Candidate product source: `3e6de5cc77c6f6f8b2fea83bfb5c045533fb6ef0`
- Host/model: Codex collaboration subagent, `gpt-5.6-terra`, low reasoning
  effort
- Context isolation: `fork_turns: none`; task name `exact_status_probe`
- Fixture: disposable `mktemp -d` directory containing an actual Repo-B Git
  worktree, a machine binding, a separate Git ledger with a committed canonical
  overlay, local materialized files, a hydrated tree-ID record, and clone-local
  excludes
- Unhealthy state: the local `AGENTS.local.md` has an appended divergent edit
  while its recorded tree ID still names the canonical ledger tree

### Exact fixture command

The following zsh-compatible command was run from the agentic repository. It
uses `source_path`, not zsh's special `path` array. Every candidate-branch
source needed to answer this probe is extracted from the exact candidate
commit; no installed global suite is read.

```sh
set -euo pipefail
status_probe_root="$(mktemp -d "${TMPDIR:-/tmp}/slipway-codex-status-probe.XXXXXX")"
candidate_sha="3e6de5cc77c6f6f8b2fea83bfb5c045533fb6ef0"
for source_path in \
  packages/slipway/skills/slipway/SKILL.md \
  packages/slipway/skills/slipway-status/SKILL.md \
  packages/slipway/skills/slipway/references/safety.md \
  packages/slipway/skills/slipway/references/store.md \
  packages/slipway/skills/slipway/references/setup.md \
  packages/slipway/skills/slipway/references/run-start.md; do
  mkdir -p "$status_probe_root/branch-source/$(dirname "$source_path")"
  git show "$candidate_sha:$source_path" \
    > "$status_probe_root/branch-source/$source_path"
done

mkdir -p \
  "$status_probe_root/repo-b" \
  "$status_probe_root/delivery" \
  "$status_probe_root/ledger/.slipway/agent-overlay"
git -C "$status_probe_root/repo-b" init -q -b feature/status-probe
git -C "$status_probe_root/repo-b" config user.name 'Probe Fixture'
git -C "$status_probe_root/repo-b" config user.email 'probe@example.test'
printf '%s\n' '# Disposable Repo B' > "$status_probe_root/repo-b/README.md"
git -C "$status_probe_root/repo-b" add README.md
git -C "$status_probe_root/repo-b" commit -qm 'seed disposable Repo B'
git -C "$status_probe_root/delivery" init -q -b main
git -C "$status_probe_root/ledger" init -q -b slipway-ledger
git -C "$status_probe_root/ledger" config user.name 'Probe Fixture'
git -C "$status_probe_root/ledger" config user.email 'probe@example.test'

for source_path in manifest.md AGENTS.local.md CLAUDE.local.md; do
  git show \
    "$candidate_sha:packages/slipway/skills/slipway/assets/agent-overlay/$source_path" \
    > "$status_probe_root/ledger/.slipway/agent-overlay/$source_path"
done
git -C "$status_probe_root/ledger" add .slipway/agent-overlay
git -C "$status_probe_root/ledger" commit -qm 'seed canonical probe overlay'
canonical_tree_id="$(
  git -C "$status_probe_root/ledger" rev-parse HEAD:.slipway/agent-overlay
)"
git_common_dir="$(
  git -C "$status_probe_root/repo-b" \
    rev-parse --path-format=absolute --git-common-dir
)"

mkdir -p "$status_probe_root/repo-b/.slipway-local"
printf '%s\n' \
  '# Slipway machine binding' \
  '' \
  "- Agentic repository path: $status_probe_root/repo-b" \
  "- Agentic worktree root: $status_probe_root/repo-b" \
  "- Delivery repository path: $status_probe_root/delivery" \
  "- Delivery worktree path: $status_probe_root/delivery" \
  "- Ledger worktree path: $status_probe_root/ledger" \
  "- Git common directory: $git_common_dir" \
  '- Expected provider account: probe@example.test' \
  '- Confirmed at: 2026-08-06T00:00:00Z' \
  > "$status_probe_root/repo-b/.slipway-local/binding.md"
cp \
  "$status_probe_root/ledger/.slipway/agent-overlay/AGENTS.local.md" \
  "$status_probe_root/repo-b/AGENTS.local.md"
printf '\nContradictory local edit: use a private tool unconditionally.\n' \
  >> "$status_probe_root/repo-b/AGENTS.local.md"
cp \
  "$status_probe_root/ledger/.slipway/agent-overlay/CLAUDE.local.md" \
  "$status_probe_root/repo-b/CLAUDE.local.md"
printf '%s\n' "$canonical_tree_id" \
  > "$status_probe_root/repo-b/.slipway-local/agent-overlay.version"
exclude_file="$(
  git -C "$status_probe_root/repo-b" \
    rev-parse --path-format=absolute --git-path info/exclude
)"
printf '%s\n' \
  /AGENTS.local.md \
  /CLAUDE.local.md \
  /docs/agents/ \
  /.slipway-local/ \
  >> "$exclude_file"

test -f \
  "$status_probe_root/branch-source/packages/slipway/skills/slipway/references/safety.md"
test -f "$status_probe_root/repo-b/.slipway-local/binding.md"
! cmp -s \
  "$status_probe_root/ledger/.slipway/agent-overlay/AGENTS.local.md" \
  "$status_probe_root/repo-b/AGENTS.local.md"
test -z "$(git -C "$status_probe_root/repo-b" status --short)"
printf 'fixture=%s\ntree=%s\n' "$status_probe_root" "$canonical_tree_id"
```

The recorded run produced fixture root
`/var/folders/t_/gxmp14gd68d71_wfqgm6_4nr0000gn/T/slipway-codex-status-probe.Oq2NZ4`
and canonical tree ID `405738e04a743b1440e5aced9804cfd6e11a2ceb`.

### Exact orchestration and prompt

This probe was not launched by a shell command. The parent Codex task used its
collaboration `spawn_agent` mechanism with task name `exact_status_probe`,
`fork_turns: none`, model `gpt-5.6-terra`, and reasoning effort `low`. The exact
prompt was:

```text
This is a fresh read-only Codex probe. Do not use any installed global Slipway skill. Read the exact candidate-branch source files under /var/folders/t_/gxmp14gd68d71_wfqgm6_4nr0000gn/T/slipway-codex-status-probe.Oq2NZ4/branch-source:
- packages/slipway/skills/slipway/SKILL.md
- packages/slipway/skills/slipway-status/SKILL.md
- packages/slipway/skills/slipway/references/safety.md
- packages/slipway/skills/slipway/references/store.md
- packages/slipway/skills/slipway/references/setup.md
- packages/slipway/skills/slipway/references/run-start.md

Inspect this exact disposable fixture read-only:
- Repo-B worktree: /var/folders/t_/gxmp14gd68d71_wfqgm6_4nr0000gn/T/slipway-codex-status-probe.Oq2NZ4/repo-b
- Binding: /var/folders/t_/gxmp14gd68d71_wfqgm6_4nr0000gn/T/slipway-codex-status-probe.Oq2NZ4/repo-b/.slipway-local/binding.md
- Canonical ledger: /var/folders/t_/gxmp14gd68d71_wfqgm6_4nr0000gn/T/slipway-codex-status-probe.Oq2NZ4/ledger
- Canonical overlay: /var/folders/t_/gxmp14gd68d71_wfqgm6_4nr0000gn/T/slipway-codex-status-probe.Oq2NZ4/ledger/.slipway/agent-overlay
- Materialized overlay and version: AGENTS.local.md, CLAUDE.local.md, and .slipway-local/agent-overlay.version in the Repo-B worktree
- Repository-local exclude: resolve it from the Repo-B worktree with read-only Git.

Requested operation: forced read-only status scoped to this local Repo-B worktree. Using only the extracted branch source and observed fixture state, state exactly: (1) observed overlay health and why, (2) whether you would invoke setup, (3) whether you would execute lane work, (4) whether validation is read-only, and (5) what you report, including hydrated tree ID and exactly one repair action. Do not edit any file, do not hydrate or repair anything, and do not inspect the installed global skill suite. Keep the answer concise.
```

### Observed output

The fresh probe returned the following output verbatim:

> 1. Overlay health: **unhealthy**. The recorded and canonical hydrated tree ID
> match: `405738e04a743b1440e5aced9804cfd6e11a2ceb`; required repository-local
> exclude patterns are present; allowed files are untracked; and
> `CLAUDE.local.md` matches. But `AGENTS.local.md` byte-diverges from the
> canonical overlay (it contains a contradictory local edit). No canonical
> `docs/agents/**` files exist, so its absence is valid.
>
> 2. Invoke setup: **No.** Forced status must not invoke setup.
>
> 3. Execute lane work: **No.** Forced status must not execute lane work.
>
> 4. Validation: **read-only**; no hydration, repair, or writes.
>
> 5. Report: local Repo-B overlay is unhealthy; hydrated tree ID
> `405738e04a743b1440e5aced9804cfd6e11a2ceb`. One repair action: **reconcile
> the divergent private `AGENTS.local.md` during an explicit
> project-policy/setup window, then rehydrate and byte-verify it.**

## Limitations

- This is one fresh-context behavioral probe, not a universal proof of host
  recursion or instruction compliance.
- It inspects candidate source extracted with `git show`; it does not test an
  installed global suite.
- The fixture creates real local Git state but does not run setup, hydrate,
  repair, execute a lane, mutate a provider, or touch the real delivery
  repository.
- The absolute temporary path is intentionally machine-specific; reruns create
  a new path and must substitute it consistently in the prompt.
- Fresh Claude Code behavior remains unverified and is not claimed here.
