#!/usr/bin/env bash
# PROTOTYPE — disposable paired-repository Git harness. Not production Slipway.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${1:-$(mktemp -d "${TMPDIR:-/tmp}/slipway-agents-overlay.XXXXXX")}"
mkdir -p "$WORK_DIR"

say() { printf '\n=== %s ===\n' "$*"; }
note() { printf '%s\n' "$*"; }
gitq() { git -c user.name='Prototype Agent' -c user.email='prototype@example.test' "$@"; }
evidence() { printf '%s\n' "$*" >> "$WORK_DIR/evidence.log"; }

write_shared_files() {
  local repo="$1"
  mkdir -p "$repo/src"
  cat > "$repo/AGENTS.md" <<'EOF'
# Trivia app instructions

Use the documented checks before delivery.

## Optional private extension

When `AGENTS.local.md` exists, read it before work. It is private Repo-B guidance:
do not commit, promote, or require it in the delivery repository.
EOF
  cat > "$repo/CLAUDE.md" <<'EOF'
@AGENTS.md
EOF
  cat > "$repo/README.md" <<'EOF'
# Trivia app

Tiny fixture application used only by the Slipway agent-overlay prototype.
EOF
  printf '%s\n' 'export const questions = ["Capital of France?"];' > "$repo/src/questions.js"
}

write_private_overlay() {
  local target="$1"
  mkdir -p "$target/docs/agents"
  cat > "$target/AGENTS.local.md" <<'EOF'
# Private Repo-B agent overlay

This file belongs only to the agentic repository/worktree. Do not include it or
`docs/agents/` in delivery cargo. The project uses Matt engineering skills.

## Agent skills

### Issue tracker

Issues and specs live as markdown files in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles use their default strings: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`; read relevant domain docs
before exploring. See `docs/agents/domain.md`.
EOF
  cat > "$target/docs/agents/issue-tracker.md" <<'EOF'
# Issue tracker: Local Markdown

Issues and specs (you may know a spec as a PRD) for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

The map is `.scratch/<effort>/map.md`; child tickets are `.scratch/<effort>/issues/NN-<slug>.md`, with `Type:`, `Status:`, and optional `Blocked by:` lines. The frontier is the first open, unblocked, unclaimed ticket by number. Claim by setting `Status: claimed`; resolve by adding `## Answer`, setting `Status: resolved`, and appending a context pointer to the map's Decisions-so-far.
EOF
  cat > "$target/docs/agents/triage-labels.md" <<'EOF'
# Triage Labels

The five canonical roles map to the identical tracker strings:

| Label in mattpocock/skills | Label in our tracker | Meaning |
| -------------------------- | -------------------- | ------- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill mentions a role, use the corresponding label string from this table.
EOF
  cat > "$target/docs/agents/domain.md" <<'EOF'
# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or **`CONTEXT-MAP.md`** if it exists.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, proceed silently. Don't flag their absence or suggest creating them upfront.

## File structure

Single-context repo (most repos): root `CONTEXT.md`, `docs/adr/`, and `src/`.

## Use the glossary's vocabulary

When output names a domain concept, use the term as defined in `CONTEXT.md`. If the concept is missing, note the gap for domain modeling.

## Flag ADR conflicts

Surface contradictions with existing ADRs explicitly rather than silently overriding them.
EOF
}

assert_no_private_cargo() {
  local repo_a="$1" cargo_sha="$2" label="$3"
  if gitq -C "$repo_a" show --format= --name-only "$cargo_sha" | grep -Eq '(^AGENTS\.local\.md$|^docs/agents/)'; then
    note "ASSERTION FAILED [$label]: private overlay entered Repo A cargo"
    exit 1
  fi
  note "PASS [$label]: delivery cargo has zero AGENTS.local.md or docs/agents/** paths"
  if gitq -C "$repo_a" ls-files | grep -Eq '(^AGENTS\.local\.md$|^docs/agents/)'; then
    note "ASSERTION FAILED [$label]: private paths exist in delivery checkout"
    exit 1
  fi
  if gitq -C "$repo_a" grep -n -I -E 'Private Repo-B agent overlay|needs-triage|Local Markdown' HEAD -- AGENTS.md CLAUDE.md README.md >/dev/null 2>&1; then
    note "ASSERTION FAILED [$label]: private overlay marker leaked into delivery text"
    exit 1
  fi
  evidence "$label: cargo_sha=$cargo_sha; delivery_paths=zero; delivery_markers=zero"
  note "PASS [$label]: delivery checkout and public instruction files have zero private-overlay markers"
}

promote_exact_cargo() {
  local repo_a="$1" agentic_origin="$2" branch="$3" cargo_sha="$4"
  gitq -C "$repo_a" fetch -q "$agentic_origin" "$branch"
  gitq -C "$repo_a" cherry-pick "$cargo_sha" >/dev/null
}

show_state() {
  local repo_b="$1" label="$2"
  say "$label — Repo B branch graph"
  gitq -C "$repo_b" log --oneline --decorate --all --graph -12
  note "Repo B status: $(gitq -C "$repo_b" status --short | sed -n '1,4p' | tr '\n' ' ' || true)"
  note "Private paths:"
  (cd "$repo_b" && find AGENTS.local.md docs/agents -type f 2>/dev/null | sort) || true
  note "Private paths tracked by feature/alpha (if committed):"
  gitq -C "$repo_b" ls-tree -r --name-only feature/alpha 2>/dev/null | grep -E '^(AGENTS\.local\.md|docs/agents/)' || true
}

init_pair() {
  local base="$1"
  mkdir -p "$base/repo-a"
  gitq -C "$base/repo-a" init -q -b main
  write_shared_files "$base/repo-a"
  gitq -C "$base/repo-a" add .
  gitq -C "$base/repo-a" commit -qm 'seed trivia app with generic AGENTS extension point'
  gitq init --bare -q "$base/repo-b-origin.git"
  gitq clone -q "$base/repo-a" "$base/repo-b-seed"
  gitq -C "$base/repo-b-seed" remote set-url origin "$base/repo-b-origin.git"
  gitq -C "$base/repo-b-seed" push -qu origin main
  gitq clone -q "$base/repo-b-origin.git" "$base/repo-b"
  gitq -C "$base/repo-b" remote add delivery "$base/repo-a"
}

add_product_commit() {
  local repo="$1" text="$2"
  printf '%s\n' "export const questions = [\"Capital of France?\", \"$text\"];" > "$repo/src/questions.js"
  gitq -C "$repo" add src/questions.js
  gitq -C "$repo" commit -qm "product: add trivia question $text"
  gitq -C "$repo" rev-parse HEAD
}

change_delivery_agents_and_sync() {
  local repo_a="$1" repo_b="$2"
  printf '\n- Never assume optional agent skills are installed.\n' >> "$repo_a/AGENTS.md"
  gitq -C "$repo_a" add AGENTS.md
  gitq -C "$repo_a" commit -qm 'docs: clarify optional skills on delivery repo'
  gitq -C "$repo_b" fetch -q delivery main
  gitq -C "$repo_b" switch -q main
  gitq -C "$repo_b" merge -q --ff-only delivery/main
  gitq -C "$repo_b" push -q origin main
}

metadata_strategy() {
  local base="$WORK_DIR/01-metadata-commit" a="$WORK_DIR/01-metadata-commit/repo-a" b="$WORK_DIR/01-metadata-commit/repo-b"
  init_pair "$base"
  say 'Strategy 1: per-run committed metadata overlay'
  for feature in alpha beta; do
    gitq -C "$b" switch -q -c "feature/$feature" main
    write_private_overlay "$b"
    gitq -C "$b" add AGENTS.local.md docs/agents
    gitq -C "$b" commit -qm "agentic: hydrate private Matt overlay for $feature"
    add_product_commit "$b" "${feature}-question" >/dev/null
    gitq -C "$b" push -qu origin "feature/$feature"
  done
  local cargo
  cargo="$(gitq -C "$b" rev-parse feature/alpha)"
  promote_exact_cargo "$a" "$base/repo-b-origin.git" feature/alpha "$cargo"
  assert_no_private_cargo "$a" "$cargo" 'metadata commit'
  gitq -C "$b" switch -q feature/alpha
  gitq -C "$b" worktree add -q "$base/fresh-worktree" feature/beta
  test -f "$base/fresh-worktree/AGENTS.local.md"
  note 'PASS [metadata commit]: fresh Repo-B worktree receives overlay from its branch history'
  change_delivery_agents_and_sync "$a" "$b"
  show_state "$b" 'metadata after Repo-A AGENTS change + Repo-B main sync'
}

overlay_branch_strategy() {
  local base="$WORK_DIR/02-overlay-branch" a="$WORK_DIR/02-overlay-branch/repo-a" b="$WORK_DIR/02-overlay-branch/repo-b"
  init_pair "$base"
  say 'Strategy 2: long-lived committed agentic overlay base branch'
  gitq -C "$b" switch -q -c agentic-overlay main
  write_private_overlay "$b"
  gitq -C "$b" add AGENTS.local.md docs/agents
  gitq -C "$b" commit -qm 'agentic: establish private Matt overlay base'
  gitq -C "$b" push -qu origin agentic-overlay
  for feature in alpha beta; do
    gitq -C "$b" switch -q -c "feature/$feature" agentic-overlay
    add_product_commit "$b" "${feature}-question" >/dev/null
    gitq -C "$b" push -qu origin "feature/$feature"
  done
  local cargo
  cargo="$(gitq -C "$b" rev-parse feature/alpha)"
  promote_exact_cargo "$a" "$base/repo-b-origin.git" feature/alpha "$cargo"
  assert_no_private_cargo "$a" "$cargo" 'overlay branch'
  gitq -C "$b" clone -q "$base/repo-b-origin.git" "$base/second-machine"
  test -f "$base/second-machine/AGENTS.local.md" || true
  gitq -C "$base/second-machine" switch -q agentic-overlay
  test -f "$base/second-machine/AGENTS.local.md"
  note 'PASS [overlay branch]: fresh machine receives overlay only after selecting agentic-overlay'
  change_delivery_agents_and_sync "$a" "$b"
  gitq -C "$b" switch -q agentic-overlay
  gitq -C "$b" rebase -q main
  gitq -C "$b" push -q --force-with-lease origin agentic-overlay
  show_state "$b" 'overlay branch after rebase onto synced Repo-B main'
}

hydrate_from_ledger() {
  local ledger="$1" target="$2"
  local version
  version="$(gitq -C "$ledger" rev-parse HEAD)"
  mkdir -p "$target/docs" "$target/.slipway-local"
  rm -rf "$target/docs/agents"
  cp "$ledger/AGENTS.local.md" "$target/AGENTS.local.md"
  cp -R "$ledger/docs/agents" "$target/docs/agents"
  printf '%s\n' "$version" > "$target/.slipway-local/agent-overlay.version"
  for pattern in /AGENTS.local.md /docs/agents/ /.slipway-local/; do
    grep -qxF "$pattern" "$target/.git/info/exclude" || printf '%s\n' "$pattern" >> "$target/.git/info/exclude"
  done
}

overlay_is_fresh() {
  local ledger="$1" target="$2"
  test -f "$target/AGENTS.local.md" || return 1
  test -f "$target/.slipway-local/agent-overlay.version" || return 1
  test "$(cat "$target/.slipway-local/agent-overlay.version")" = "$(gitq -C "$ledger" rev-parse HEAD)" || return 1
  cmp -s "$ledger/AGENTS.local.md" "$target/AGENTS.local.md" || return 1
  for name in issue-tracker.md triage-labels.md domain.md; do
    cmp -s "$ledger/docs/agents/$name" "$target/docs/agents/$name" || return 1
  done
}

assert_overlay_fresh() {
  local ledger="$1" target="$2" label="$3"
  if ! overlay_is_fresh "$ledger" "$target"; then
    note "ASSERTION FAILED [$label]: hydrated overlay is missing or stale"
    exit 1
  fi
  evidence "$label: overlay_version=$(gitq -C "$ledger" rev-parse HEAD); fresh=true"
  note "PASS [$label]: hydrated overlay matches the exact ledger version"
}

ignored_overlay_strategy() {
  local base="$WORK_DIR/03-ledger-ignored-overlay" a="$WORK_DIR/03-ledger-ignored-overlay/repo-a" b="$WORK_DIR/03-ledger-ignored-overlay/repo-b" ledger="$WORK_DIR/03-ledger-ignored-overlay/ledger"
  init_pair "$base"
  say 'Strategy 3: ledger-backed ignored worktree overlay'
  gitq -C "$base" init -q ledger
  write_private_overlay "$ledger"
  gitq -C "$ledger" add .
  gitq -C "$ledger" commit -qm 'ledger: canonical private Matt overlay'
  for feature in alpha beta; do
    gitq -C "$b" switch -q -c "feature/$feature" main
    hydrate_from_ledger "$ledger" "$b"
    hydrate_from_ledger "$ledger" "$b"
    assert_overlay_fresh "$ledger" "$b" "ignored overlay idempotent hydration for $feature"
    test "$(grep -cxF /AGENTS.local.md "$b/.git/info/exclude")" -eq 1
    test "$(grep -cxF /docs/agents/ "$b/.git/info/exclude")" -eq 1
    test "$(grep -cxF /.slipway-local/ "$b/.git/info/exclude")" -eq 1
    add_product_commit "$b" "${feature}-question" >/dev/null
    gitq -C "$b" push -qu origin "feature/$feature"
    note "Ignored overlay status for $feature: $(gitq -C "$b" status --short | tr '\n' ' ' || true)"
  done
  local cargo
  cargo="$(gitq -C "$b" rev-parse feature/alpha)"
  promote_exact_cargo "$a" "$base/repo-b-origin.git" feature/alpha "$cargo"
  assert_no_private_cargo "$a" "$cargo" 'ledger ignored overlay'
  gitq clone -q "$base/repo-b-origin.git" "$base/second-machine"
  gitq -C "$base/second-machine" switch -q feature/beta
  if test ! -f "$base/second-machine/AGENTS.local.md"; then
    note 'EXPECTED [ignored overlay]: fresh machine has no overlay until Slipway hydrates it from ledger'
  fi
  hydrate_from_ledger "$ledger" "$base/second-machine"
  assert_overlay_fresh "$ledger" "$base/second-machine" 'ignored overlay fresh-machine reconstruction'
  note 'PASS [ignored overlay]: ledger hydration reconstructs private guidance on fresh machine'
  printf '\n## Tool guidance\n\nUse CodeGraph when it is installed and the task needs structural exploration.\n' >> "$ledger/AGENTS.local.md"
  gitq -C "$ledger" add AGENTS.local.md
  gitq -C "$ledger" commit -qm 'ledger: add optional CodeGraph guidance'
  if overlay_is_fresh "$ledger" "$base/second-machine"; then
    note 'ASSERTION FAILED [ignored overlay]: stale second-machine overlay was not detected'
    exit 1
  fi
  note 'PASS [ignored overlay]: ledger version change makes the prior hydration detectably stale'
  hydrate_from_ledger "$ledger" "$base/second-machine"
  assert_overlay_fresh "$ledger" "$base/second-machine" 'ignored overlay stale recovery'
  change_delivery_agents_and_sync "$a" "$b"
  hydrate_from_ledger "$ledger" "$b"
  assert_overlay_fresh "$ledger" "$b" 'ignored overlay after Repo-B main sync'
  show_state "$b" 'ignored overlay after Repo-A AGENTS change + Repo-B main sync'
}

metadata_strategy
overlay_branch_strategy
ignored_overlay_strategy

say 'Result'
note "All three strategies passed cargo isolation. Disposable repositories retained at: $WORK_DIR"
note 'Read each state block above: committed strategies expose private files in Repo-B history; ignored strategy requires explicit hydration.'
note "Evidence log: $WORK_DIR/evidence.log"
