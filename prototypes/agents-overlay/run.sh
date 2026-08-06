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

When `AGENTS.local.md` exists, read it after this file. It contains local-only
instructions and must not be committed.
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

write_overlay_manifest() {
  local target="$1"
  cp "$ROOT_DIR/../../packages/slipway/skills/slipway/assets/agent-overlay/manifest.md" "$target/manifest.md"
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
  cat > "$target/CLAUDE.local.md" <<'EOF'
@AGENTS.local.md
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
  if gitq -C "$repo_a" show --format= --name-only "$cargo_sha" | grep -Eq '(^AGENTS\.local\.md$|^CLAUDE\.local\.md$|^docs/agents/)'; then
    note "ASSERTION FAILED [$label]: private overlay entered Repo A cargo"
    exit 1
  fi
  note "PASS [$label]: delivery cargo has zero private overlay paths"
  if gitq -C "$repo_a" ls-files | grep -Eq '(^AGENTS\.local\.md$|^CLAUDE\.local\.md$|^docs/agents/)'; then
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
  (cd "$repo_b" && find AGENTS.local.md CLAUDE.local.md docs/agents -type f 2>/dev/null | sort) || true
  note "Private paths tracked by feature/alpha (if committed):"
  gitq -C "$repo_b" ls-tree -r --name-only feature/alpha 2>/dev/null | grep -E '^(AGENTS\.local\.md|CLAUDE\.local\.md|docs/agents/)' || true
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
    gitq -C "$b" add AGENTS.local.md CLAUDE.local.md docs/agents
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
  test -f "$base/fresh-worktree/CLAUDE.local.md"
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
  gitq -C "$b" add AGENTS.local.md CLAUDE.local.md docs/agents
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
  test -f "$base/second-machine/CLAUDE.local.md"
  note 'PASS [overlay branch]: fresh machine receives overlay only after selecting agentic-overlay'
  change_delivery_agents_and_sync "$a" "$b"
  gitq -C "$b" switch -q agentic-overlay
  gitq -C "$b" rebase -q main
  gitq -C "$b" push -q --force-with-lease origin agentic-overlay
  show_state "$b" 'overlay branch after rebase onto synced Repo-B main'
}

hydrate_from_ledger() (
  local ledger="$1" target="$2"
  local version exclude temp_base stage_dir canonical_dir expected_manifest
  local entry metadata mode type source_path tracked recorded baseline actual relative prior_file pattern
  local resolved head_objects
  temp_base="${TMPDIR:-/tmp}"
  temp_base="${temp_base%/}"
  stage_dir="$(mktemp -d "$temp_base/slipway-overlay-stage.XXXXXX")"
  cleanup_hydration_stage() {
    case "$stage_dir" in
      "$temp_base"/slipway-overlay-stage.*)
        rm -rf -- "$stage_dir"
        ;;
      *)
        note "ASSERTION FAILED [hydrate]: refusing unsafe temporary cleanup: $stage_dir"
        ;;
    esac
  }
  trap cleanup_hydration_stage EXIT

  version="$(gitq -C "$ledger" rev-parse HEAD:.slipway/agent-overlay)"
  resolved="$(gitq -C "$ledger" rev-parse --verify "$version^{tree}" 2>/dev/null || true)"
  if test -z "$version" || test "$resolved" != "$version" || test "$(gitq -C "$ledger" cat-file -t "$version" 2>/dev/null || true)" != tree; then
    note 'HYDRATION REFUSED: canonical overlay tree is missing or invalid'
    return 1
  fi
  head_objects="$(gitq -C "$ledger" rev-list --objects HEAD -- .slipway/agent-overlay)"
  if ! grep -qxF "$version .slipway/agent-overlay" <<< "$head_objects"; then
    note 'HYDRATION REFUSED: canonical overlay tree is not reachable at the bound ledger path'
    return 1
  fi

  : > "$stage_dir/source-files"
  while IFS= read -r -d '' entry; do
    metadata="${entry%%$'\t'*}"
    source_path="${entry#*$'\t'}"
    mode="${metadata%% *}"
    metadata="${metadata#* }"
    type="${metadata%% *}"
    if test "$mode" != 100644 || test "$type" != blob; then
      note "HYDRATION REFUSED: canonical source is not a regular file: $source_path"
      return 1
    fi
    if ! [[ "$source_path" =~ ^[A-Za-z0-9._/-]+$ ]] ||
       [[ "/$source_path/" == *'/../'* ]] || [[ "/$source_path/" == *'/./'* ]] ||
       [[ "$source_path" == /* ]] || [[ "$source_path" == *'//'* ]]; then
      note "HYDRATION REFUSED: canonical source has an invalid destination: $source_path"
      return 1
    fi
    case "$source_path" in
      manifest.md|AGENTS.local.md|CLAUDE.local.md|docs/agents/*)
        ;;
      *)
        note "HYDRATION REFUSED: canonical source is outside the manifest allowlist: $source_path"
        return 1
        ;;
    esac
    if test "$source_path" = docs/agents/; then
      note 'HYDRATION REFUSED: canonical docs/agents destination is not a file'
      return 1
    fi
    printf '%s\n' "$source_path" >> "$stage_dir/source-files"
  done < <(gitq -C "$ledger" ls-tree -r -z "$version")

  for source_path in manifest.md AGENTS.local.md CLAUDE.local.md; do
    if test "$(grep -cxF "$source_path" "$stage_dir/source-files")" -ne 1; then
      note "HYDRATION REFUSED: required canonical source is missing or duplicated: $source_path"
      return 1
    fi
  done

  canonical_dir="$stage_dir/canonical"
  mkdir -p "$canonical_dir"
  gitq -C "$ledger" archive "$version" | tar -x -C "$canonical_dir"
  while IFS= read -r source_path; do
    if test ! -f "$canonical_dir/$source_path" || test -L "$canonical_dir/$source_path" || test ! -s "$canonical_dir/$source_path"; then
      note "HYDRATION REFUSED: canonical source is missing, empty, or non-regular: $source_path"
      return 1
    fi
  done < "$stage_dir/source-files"

  expected_manifest="$ROOT_DIR/../../packages/slipway/skills/slipway/assets/agent-overlay/manifest.md"
  if test ! -f "$expected_manifest" || ! cmp -s "$canonical_dir/manifest.md" "$expected_manifest"; then
    note 'HYDRATION REFUSED: canonical manifest or allowlist is invalid'
    return 1
  fi

  if test -L "$target/docs" || { test -e "$target/docs" && test ! -d "$target/docs"; } ||
     test -L "$target/.slipway-local" || { test -e "$target/.slipway-local" && test ! -d "$target/.slipway-local"; }; then
    note 'HYDRATION REFUSED: a destination parent is not a regular directory'
    return 1
  fi
  for relative in AGENTS.local.md CLAUDE.local.md .slipway-local/agent-overlay.version; do
    actual="$target/$relative"
    if test -L "$actual" || { test -e "$actual" && test ! -f "$actual"; }; then
      note "HYDRATION REFUSED: destination is not a regular file: $relative"
      return 1
    fi
  done
  if test -e "$target/docs/agents" && { test -L "$target/docs/agents" || test ! -d "$target/docs/agents"; }; then
    note 'HYDRATION REFUSED: docs/agents destination is not a regular directory'
    return 1
  fi

  tracked="$(gitq -C "$target" ls-files -- AGENTS.local.md CLAUDE.local.md docs/agents .slipway-local)"
  if test -n "$tracked"; then
    note "HYDRATION REFUSED: private path is tracked: $(printf '%s' "$tracked" | head -n 1)"
    return 1
  fi

  recorded=''
  if test -f "$target/.slipway-local/agent-overlay.version"; then
    recorded="$(cat "$target/.slipway-local/agent-overlay.version")"
    resolved="$(gitq -C "$ledger" rev-parse --verify "$recorded^{tree}" 2>/dev/null || true)"
    if test "$(wc -l < "$target/.slipway-local/agent-overlay.version" | tr -d ' ')" -ne 1 ||
       test -z "$recorded" || test "$resolved" != "$recorded" ||
       test "$(gitq -C "$ledger" cat-file -t "$recorded" 2>/dev/null || true)" != tree ||
       ! grep -qxF "$recorded .slipway/agent-overlay" <<< "$head_objects"; then
      note 'HYDRATION REFUSED: recorded overlay tree ID is invalid or unreachable'
      return 1
    fi
  fi
  baseline="${recorded:-$version}"
  : > "$stage_dir/obsolete-paths"

  if test -d "$target/docs/agents"; then
    if test ! -d "$canonical_dir/docs/agents"; then
      type="$(gitq -C "$ledger" cat-file -t "$baseline:docs/agents" 2>/dev/null || true)"
      if test "$type" != tree; then
        note 'HYDRATION REFUSED: docs/agents is owned by neither current nor recorded overlay'
        return 1
      fi
      printf '%s\n' docs/agents >> "$stage_dir/obsolete-paths"
    fi
    while IFS= read -r actual; do
      relative="${actual#"$target/"}"
      if ! [[ "$relative" =~ ^docs/agents/[A-Za-z0-9._/-]+$ ]] ||
         [[ "/$relative/" == *'/../'* ]] || [[ "/$relative/" == *'/./'* ]] ||
         [[ "$relative" == *'//'* ]] || test -L "$actual" ||
         { test ! -f "$actual" && test ! -d "$actual"; }; then
        note "HYDRATION REFUSED: unexpected or invalid materialized path: $relative"
        return 1
      fi
      if test -e "$canonical_dir/$relative"; then
        if { test -d "$actual" && test ! -d "$canonical_dir/$relative"; } ||
           { test -f "$actual" && test ! -f "$canonical_dir/$relative"; }; then
          note "HYDRATION REFUSED: materialized type disagrees with canonical path: $relative"
          return 1
        fi
      else
        type="$(gitq -C "$ledger" cat-file -t "$baseline:$relative" 2>/dev/null || true)"
        if test -f "$actual" && test "$type" = blob; then
          prior_file="$stage_dir/prior-file"
          if ! gitq -C "$ledger" show "$baseline:$relative" > "$prior_file" 2>/dev/null || ! cmp -s "$prior_file" "$actual"; then
            note "HYDRATION REFUSED: obsolete path diverges from its recorded baseline: $relative"
            return 1
          fi
        elif test -d "$actual" && test "$type" = tree; then
          :
        else
          note "HYDRATION REFUSED: path is owned by neither current nor recorded overlay: $relative"
          return 1
        fi
        printf '%s\n' "$relative" >> "$stage_dir/obsolete-paths"
      fi
    done < <(find "$target/docs/agents" -mindepth 1 -print)
  fi

  for relative in AGENTS.local.md CLAUDE.local.md; do
    actual="$target/$relative"
    if test -f "$actual"; then
      prior_file="$stage_dir/prior-file"
      if ! gitq -C "$ledger" show "$baseline:$relative" > "$prior_file" 2>/dev/null || ! cmp -s "$prior_file" "$actual"; then
        note "HYDRATION REFUSED: materialized bytes diverge from their recorded overlay: $relative"
        return 1
      fi
    fi
  done
  if test -d "$target/docs/agents"; then
    while IFS= read -r actual; do
      test -f "$actual" || continue
      relative="${actual#"$target/"}"
      prior_file="$stage_dir/prior-file"
      if ! gitq -C "$ledger" show "$baseline:$relative" > "$prior_file" 2>/dev/null || ! cmp -s "$prior_file" "$actual"; then
        note "HYDRATION REFUSED: materialized bytes diverge from their recorded overlay: $relative"
        return 1
      fi
    done < <(find "$target/docs/agents" -type f -print)
  fi

  exclude="$(gitq -C "$target" rev-parse --path-format=absolute --git-path info/exclude)"
  if test -L "$exclude" || { test -e "$exclude" && test ! -f "$exclude"; }; then
    note 'HYDRATION REFUSED: repository-local exclude is not a regular file'
    return 1
  fi

  local pre_dir pre_agents pre_claude pre_docs pre_version pre_exclude pre_docs_parent pre_local_parent
  local new_exclude new_version transaction_failed materialized_installs
  pre_dir="$stage_dir/pre-state"
  mkdir -p "$pre_dir"
  pre_agents=0
  pre_claude=0
  pre_docs=0
  pre_version=0
  pre_exclude=0
  pre_docs_parent=0
  pre_local_parent=0
  test -d "$target/docs" && pre_docs_parent=1
  test -d "$target/.slipway-local" && pre_local_parent=1
  if test -f "$target/AGENTS.local.md"; then
    cp -p "$target/AGENTS.local.md" "$pre_dir/AGENTS.local.md"
    pre_agents=1
  fi
  if test -f "$target/CLAUDE.local.md"; then
    cp -p "$target/CLAUDE.local.md" "$pre_dir/CLAUDE.local.md"
    pre_claude=1
  fi
  if test -d "$target/docs/agents"; then
    cp -Rp "$target/docs/agents" "$pre_dir/docs-agents"
    pre_docs=1
  fi
  if test -f "$target/.slipway-local/agent-overlay.version"; then
    cp -p "$target/.slipway-local/agent-overlay.version" "$pre_dir/agent-overlay.version"
    pre_version=1
  fi
  if test -f "$exclude"; then
    cp -p "$exclude" "$pre_dir/info-exclude"
    pre_exclude=1
  fi

  new_exclude="$stage_dir/new-info-exclude"
  if test "$pre_exclude" -eq 1; then
    cp -p "$pre_dir/info-exclude" "$new_exclude"
  else
    : > "$new_exclude"
  fi
  for pattern in /AGENTS.local.md /CLAUDE.local.md /docs/agents/ /.slipway-local/; do
    grep -qxF "$pattern" "$new_exclude" || printf '%s\n' "$pattern" >> "$new_exclude"
  done
  new_version="$stage_dir/new-version"
  printf '%s\n' "$version" > "$new_version"

  replace_from_staged() {
    local staged_source="$1" destination="$2" destination_parent install_temp
    destination_parent="$(dirname "$destination")"
    install_temp="$(mktemp "$destination_parent/.slipway-overlay-install.XXXXXX")" || return 1
    if ! cp -p "$staged_source" "$install_temp" || ! mv -f "$install_temp" "$destination"; then
      rm -f -- "$install_temp"
      return 1
    fi
  }

  clear_managed_docs() {
    if test -d "$target/docs/agents" && test ! -L "$target/docs/agents"; then
      find "$target/docs/agents" -depth -delete
    elif test -e "$target/docs/agents" || test -L "$target/docs/agents"; then
      rm -f -- "$target/docs/agents"
    fi
  }

  rollback_hydration() {
    local rollback_failed=0
    rm -f -- "$target/AGENTS.local.md" "$target/CLAUDE.local.md" || rollback_failed=1
    clear_managed_docs || rollback_failed=1
    rm -f -- "$target/.slipway-local/agent-overlay.version" || rollback_failed=1

    if test "$pre_agents" -eq 1; then
      replace_from_staged "$pre_dir/AGENTS.local.md" "$target/AGENTS.local.md" || rollback_failed=1
    fi
    if test "$pre_claude" -eq 1; then
      replace_from_staged "$pre_dir/CLAUDE.local.md" "$target/CLAUDE.local.md" || rollback_failed=1
    fi
    if test "$pre_docs" -eq 1; then
      mkdir -p "$target/docs" || rollback_failed=1
      cp -Rp "$pre_dir/docs-agents" "$target/docs/agents" || rollback_failed=1
    fi
    if test "$pre_version" -eq 1; then
      mkdir -p "$target/.slipway-local" || rollback_failed=1
      replace_from_staged "$pre_dir/agent-overlay.version" "$target/.slipway-local/agent-overlay.version" || rollback_failed=1
    fi
    if test "$pre_exclude" -eq 1; then
      replace_from_staged "$pre_dir/info-exclude" "$exclude" || rollback_failed=1
    else
      rm -f -- "$exclude" || rollback_failed=1
    fi
    if test "$pre_docs_parent" -eq 0; then
      rmdir "$target/docs" 2>/dev/null || true
    fi
    if test "$pre_local_parent" -eq 0; then
      rmdir "$target/.slipway-local" 2>/dev/null || true
    fi
    if test "$rollback_failed" -ne 0; then
      note 'ASSERTION FAILED [hydrate]: best-effort rollback was incomplete'
      return 1
    fi
  }

  # All canonical sources, destinations, existing bytes, and the complete new
  # state are validated or staged before the first target write below.
  transaction_failed=0
  materialized_installs=0
  mkdir -p "$target/docs" "$target/.slipway-local" || transaction_failed=1
  if test "$transaction_failed" -eq 0 && { test ! -f "$exclude" || ! cmp -s "$new_exclude" "$exclude"; }; then
    replace_from_staged "$new_exclude" "$exclude" || transaction_failed=1
  fi
  if test "$transaction_failed" -eq 0; then
    while IFS= read -r relative; do
      if test -f "$target/$relative" && test ! -L "$target/$relative"; then
        rm -f -- "$target/$relative" || transaction_failed=1
      fi
    done < "$stage_dir/obsolete-paths"
  fi
  if test "$transaction_failed" -eq 0; then
    while IFS= read -r relative; do
      if test -d "$target/$relative" && test ! -L "$target/$relative"; then
        rmdir "$target/$relative" || transaction_failed=1
      fi
    done < <(awk '{ print length($0), $0 }' "$stage_dir/obsolete-paths" | sort -rn | cut -d' ' -f2-)
  fi
  while IFS= read -r source_path; do
    test "$transaction_failed" -eq 0 || break
    test "$source_path" = manifest.md && continue
    actual="$target/$source_path"
    if test ! -f "$actual" || ! cmp -s "$canonical_dir/$source_path" "$actual"; then
      mkdir -p "$(dirname "$actual")" || transaction_failed=1
      if test "$transaction_failed" -eq 0; then
        replace_from_staged "$canonical_dir/$source_path" "$actual" || transaction_failed=1
      fi
      if test "$transaction_failed" -eq 0; then
        materialized_installs=$((materialized_installs + 1))
        if test "${SLIPWAY_OVERLAY_FAULT_AFTER_INSTALL:-0}" = 1 && test "$materialized_installs" -ge 1; then
          note 'HYDRATION REFUSED: injected post-install failure'
          transaction_failed=1
        fi
      fi
    fi
  done < "$stage_dir/source-files"

  # Audit the complete allowlisted materialization before the version advances.
  if test "$transaction_failed" -eq 0; then
    while IFS= read -r source_path; do
      test "$source_path" = manifest.md && continue
      actual="$target/$source_path"
      if test ! -f "$actual" || test -L "$actual" || ! cmp -s "$canonical_dir/$source_path" "$actual"; then
        note "HYDRATION REFUSED: post-install audit failed: $source_path"
        transaction_failed=1
        break
      fi
    done < "$stage_dir/source-files"
  fi
  if test "$transaction_failed" -eq 0 && test -d "$target/docs/agents"; then
    if test ! -d "$canonical_dir/docs/agents"; then
      note 'HYDRATION REFUSED: post-install audit found an extra docs/agents directory'
      transaction_failed=1
    fi
  fi
  if test "$transaction_failed" -eq 0 && test -d "$target/docs/agents"; then
    while IFS= read -r actual; do
      relative="${actual#"$target/"}"
      if test ! -e "$canonical_dir/$relative" || test -L "$actual" ||
         { test ! -f "$actual" && test ! -d "$actual"; } ||
         { test -d "$actual" && test ! -d "$canonical_dir/$relative"; } ||
         { test -f "$actual" && { test ! -f "$canonical_dir/$relative" || ! cmp -s "$canonical_dir/$relative" "$actual"; }; }; then
        note "HYDRATION REFUSED: post-install audit found an extra or invalid node: $relative"
        transaction_failed=1
        break
      fi
    done < <(find "$target/docs/agents" -mindepth 1 -print)
  fi

  if test "$transaction_failed" -eq 0 && test "$recorded" != "$version"; then
    replace_from_staged "$new_version" "$target/.slipway-local/agent-overlay.version" || transaction_failed=1
  fi
  if test "$transaction_failed" -eq 0 &&
     { ! cmp -s "$new_exclude" "$exclude" || ! cmp -s "$new_version" "$target/.slipway-local/agent-overlay.version"; }; then
    note 'HYDRATION REFUSED: final exclude or version verification failed'
    transaction_failed=1
  fi
  if test "$transaction_failed" -ne 0; then
    rollback_hydration || true
    return 1
  fi
)

overlay_is_fresh() {
  local ledger="$1" target="$2"
  local version source_path actual relative expected_type
  version="$(gitq -C "$ledger" rev-parse HEAD:.slipway/agent-overlay)"
  test -f "$target/.slipway-local/agent-overlay.version" || return 1
  test "$(cat "$target/.slipway-local/agent-overlay.version")" = "$version" || return 1
  while IFS= read -r source_path; do
    test "$source_path" = manifest.md && continue
    actual="$target/$source_path"
    test -f "$actual" && test ! -L "$actual" || return 1
    cmp -s <(gitq -C "$ledger" show "$version:$source_path") "$actual" || return 1
  done < <(gitq -C "$ledger" ls-tree -r --name-only "$version")
  if test -d "$target/docs/agents"; then
    while IFS= read -r actual; do
      relative="${actual#"$target/"}"
      expected_type="$(gitq -C "$ledger" cat-file -t "$version:$relative" 2>/dev/null || true)"
      if test -L "$actual" ||
         { test -f "$actual" && test "$expected_type" != blob; } ||
         { test -d "$actual" && test "$expected_type" != tree; } ||
         { test ! -f "$actual" && test ! -d "$actual"; }; then
        return 1
      fi
    done < <(find "$target/docs/agents" -mindepth 1 -print)
  fi
}

assert_overlay_fresh() {
  local ledger="$1" target="$2" label="$3"
  if ! overlay_is_fresh "$ledger" "$target"; then
    note "ASSERTION FAILED [$label]: hydrated overlay is missing or stale"
    exit 1
  fi
  evidence "$label: overlay_version=$(gitq -C "$ledger" rev-parse HEAD:.slipway/agent-overlay); fresh=true"
  note "PASS [$label]: hydrated overlay matches the exact ledger version"
}

materialized_state() {
  local target="$1" relative exclude_path
  (
    cd "$target"
    exclude_path="$(git rev-parse --path-format=absolute --git-path info/exclude)"
    if test -f "$exclude_path"; then
      printf 'exclude %s\n' "$(git hash-object "$exclude_path")"
    fi
    find . \( \
        -path './AGENTS.local.md' -o \
        -path './CLAUDE.local.md' -o \
        -path './docs/agents' -o \
        -path './docs/agents/*' -o \
        -path './.slipway-local/agent-overlay.version' \
      \) -print |
      sort |
      while IFS= read -r relative; do
        relative="${relative#./}"
        if test -f "$relative" && test ! -L "$relative"; then
          printf 'file %s %s\n' "$relative" "$(git hash-object "$relative")"
        elif test -d "$relative" && test ! -L "$relative"; then
          printf 'dir %s\n' "$relative"
        elif test -L "$relative"; then
          printf 'link %s %s\n' "$relative" "$(readlink "$relative")"
        elif test -p "$relative"; then
          printf 'fifo %s\n' "$relative"
        elif test -S "$relative"; then
          printf 'socket %s\n' "$relative"
        elif test -b "$relative"; then
          printf 'block %s\n' "$relative"
        elif test -c "$relative"; then
          printf 'character %s\n' "$relative"
        else
          printf 'special %s\n' "$relative"
        fi
      done
  )
}

ignored_overlay_strategy() {
  local base="$WORK_DIR/03-ledger-ignored-overlay" a="$WORK_DIR/03-ledger-ignored-overlay/repo-a" b="$WORK_DIR/03-ledger-ignored-overlay/repo-b" ledger="$WORK_DIR/03-ledger-ignored-overlay/ledger"
  init_pair "$base"
  say 'Strategy 3: ledger-backed ignored worktree overlay'
  gitq -C "$base" init -q ledger
  write_private_overlay "$ledger/.slipway/agent-overlay"
  write_overlay_manifest "$ledger/.slipway/agent-overlay"
  gitq -C "$ledger" add .
  gitq -C "$ledger" commit -qm 'ledger: canonical private Matt overlay'

  local refusal_target before_state after_state before_head refusal_ledger
  refusal_target="$base/refuse-divergent"
  gitq clone -q "$base/repo-b-origin.git" "$refusal_target"
  hydrate_from_ledger "$ledger" "$refusal_target"
  printf '\nLocal divergent policy edit.\n' >> "$refusal_target/AGENTS.local.md"
  before_state="$(materialized_state "$refusal_target")"
  if hydrate_from_ledger "$ledger" "$refusal_target"; then
    note 'ASSERTION FAILED [ignored overlay]: divergent local edit was overwritten'
    exit 1
  fi
  after_state="$(materialized_state "$refusal_target")"
  test "$before_state" = "$after_state"
  note 'PASS [ignored overlay]: divergent local bytes fail closed and remain unchanged'

  refusal_target="$base/refuse-unexpected"
  gitq clone -q "$base/repo-b-origin.git" "$refusal_target"
  hydrate_from_ledger "$ledger" "$refusal_target"
  printf '%s\n' 'unexpected private policy' > "$refusal_target/docs/agents/unexpected.md"
  before_state="$(materialized_state "$refusal_target")"
  if hydrate_from_ledger "$ledger" "$refusal_target"; then
    note 'ASSERTION FAILED [ignored overlay]: unexpected materialized path was accepted'
    exit 1
  fi
  after_state="$(materialized_state "$refusal_target")"
  test "$before_state" = "$after_state"
  note 'PASS [ignored overlay]: unexpected materialized path fails closed and remains unchanged'

  refusal_target="$base/refuse-tracked"
  gitq clone -q "$base/repo-b-origin.git" "$refusal_target"
  cp "$ledger/.slipway/agent-overlay/AGENTS.local.md" "$refusal_target/AGENTS.local.md"
  gitq -C "$refusal_target" add AGENTS.local.md
  gitq -C "$refusal_target" commit -qm 'fixture: track forbidden private policy'
  before_head="$(gitq -C "$refusal_target" rev-parse HEAD)"
  before_state="$(materialized_state "$refusal_target")"
  if hydrate_from_ledger "$ledger" "$refusal_target"; then
    note 'ASSERTION FAILED [ignored overlay]: tracked private path was accepted'
    exit 1
  fi
  after_state="$(materialized_state "$refusal_target")"
  test "$before_state" = "$after_state"
  test "$before_head" = "$(gitq -C "$refusal_target" rev-parse HEAD)"
  note 'PASS [ignored overlay]: tracked private path fails before hydration writes'

  refusal_target="$base/refuse-fifo"
  gitq clone -q "$base/repo-b-origin.git" "$refusal_target"
  mkfifo "$refusal_target/AGENTS.local.md"
  before_state="$(materialized_state "$refusal_target")"
  if hydrate_from_ledger "$ledger" "$refusal_target"; then
    note 'ASSERTION FAILED [ignored overlay]: FIFO destination was accepted'
    exit 1
  fi
  after_state="$(materialized_state "$refusal_target")"
  test "$before_state" = "$after_state"
  test -p "$refusal_target/AGENTS.local.md"
  note 'PASS [ignored overlay]: FIFO destination fails closed and remains unchanged'

  refusal_ledger="$base/refuse-malformed-manifest-ledger"
  gitq clone -q "$ledger" "$refusal_ledger"
  gitq -C "$refusal_ledger" config user.name 'Prototype Agent'
  gitq -C "$refusal_ledger" config user.email 'prototype@example.test'
  printf '%s\n' '# malformed manifest' > "$refusal_ledger/.slipway/agent-overlay/manifest.md"
  gitq -C "$refusal_ledger" add .slipway/agent-overlay/manifest.md
  gitq -C "$refusal_ledger" commit -qm 'fixture: malformed overlay manifest'
  refusal_target="$base/refuse-malformed-manifest"
  gitq clone -q "$base/repo-b-origin.git" "$refusal_target"
  before_state="$(materialized_state "$refusal_target")"
  if hydrate_from_ledger "$refusal_ledger" "$refusal_target"; then
    note 'ASSERTION FAILED [ignored overlay]: malformed canonical manifest was accepted'
    exit 1
  fi
  after_state="$(materialized_state "$refusal_target")"
  test "$before_state" = "$after_state"
  note 'PASS [ignored overlay]: malformed canonical manifest fails before target writes'

  refusal_ledger="$base/refuse-outside-allowlist-ledger"
  gitq clone -q "$ledger" "$refusal_ledger"
  gitq -C "$refusal_ledger" config user.name 'Prototype Agent'
  gitq -C "$refusal_ledger" config user.email 'prototype@example.test'
  printf '%s\n' 'outside allowlist' > "$refusal_ledger/.slipway/agent-overlay/private.md"
  gitq -C "$refusal_ledger" add .slipway/agent-overlay/private.md
  gitq -C "$refusal_ledger" commit -qm 'fixture: add out-of-allowlist overlay path'
  refusal_target="$base/refuse-outside-allowlist"
  gitq clone -q "$base/repo-b-origin.git" "$refusal_target"
  before_state="$(materialized_state "$refusal_target")"
  if hydrate_from_ledger "$refusal_ledger" "$refusal_target"; then
    note 'ASSERTION FAILED [ignored overlay]: out-of-allowlist canonical path was accepted'
    exit 1
  fi
  after_state="$(materialized_state "$refusal_target")"
  test "$before_state" = "$after_state"
  note 'PASS [ignored overlay]: out-of-allowlist canonical path fails before target writes'

  refusal_target="$base/refuse-invalid-version"
  gitq clone -q "$base/repo-b-origin.git" "$refusal_target"
  hydrate_from_ledger "$ledger" "$refusal_target"
  printf '%s\n' 'not-a-full-git-object-id' > "$refusal_target/.slipway-local/agent-overlay.version"
  before_state="$(materialized_state "$refusal_target")"
  if hydrate_from_ledger "$ledger" "$refusal_target"; then
    note 'ASSERTION FAILED [ignored overlay]: invalid recorded tree ID was accepted'
    exit 1
  fi
  after_state="$(materialized_state "$refusal_target")"
  test "$before_state" = "$after_state"
  note 'PASS [ignored overlay]: invalid recorded tree ID fails closed and remains unchanged'

  refusal_target="$base/refuse-unreachable-version"
  gitq clone -q "$base/repo-b-origin.git" "$refusal_target"
  hydrate_from_ledger "$ledger" "$refusal_target"
  printf '%s\n' "$(gitq -C "$refusal_target" rev-parse HEAD^{tree})" > "$refusal_target/.slipway-local/agent-overlay.version"
  before_state="$(materialized_state "$refusal_target")"
  if hydrate_from_ledger "$ledger" "$refusal_target"; then
    note 'ASSERTION FAILED [ignored overlay]: unreachable recorded tree ID was accepted'
    exit 1
  fi
  after_state="$(materialized_state "$refusal_target")"
  test "$before_state" = "$after_state"
  note 'PASS [ignored overlay]: unreachable recorded tree ID fails closed and remains unchanged'

  refusal_target="$base/refuse-injected-failure"
  gitq clone -q "$base/repo-b-origin.git" "$refusal_target"
  before_state="$(materialized_state "$refusal_target")"
  if SLIPWAY_OVERLAY_FAULT_AFTER_INSTALL=1 hydrate_from_ledger "$ledger" "$refusal_target"; then
    note 'ASSERTION FAILED [ignored overlay]: injected post-install failure did not fail'
    exit 1
  fi
  after_state="$(materialized_state "$refusal_target")"
  test "$before_state" = "$after_state"
  test ! -e "$refusal_target/AGENTS.local.md"
  test ! -e "$refusal_target/CLAUDE.local.md"
  test ! -e "$refusal_target/docs"
  test ! -e "$refusal_target/.slipway-local"
  note 'PASS [ignored overlay]: injected post-install failure rolls back files, types, version, and full exclude'

  for feature in alpha beta; do
    gitq -C "$b" switch -q -c "feature/$feature" main
    local exclude baseline_exclude expected_exclude exclude_peer
    exclude="$(gitq -C "$b" rev-parse --path-format=absolute --git-path info/exclude)"
    baseline_exclude=$'# existing clone-local policy\n/team-local-cache/\n*.developer-scratch\n'
    printf '%s' "$baseline_exclude" > "$exclude"
    expected_exclude="$base/expected-exclude-$feature"
    printf '%s' "$baseline_exclude" > "$expected_exclude"
    printf '%s\n' /AGENTS.local.md /CLAUDE.local.md /docs/agents/ /.slipway-local/ >> "$expected_exclude"
    exclude_peer="$base/exclude-hardlink-peer-$feature"
    ln "$exclude" "$exclude_peer"
    hydrate_from_ledger "$ledger" "$b"
    before_state="$(materialized_state "$b")"
    hydrate_from_ledger "$ledger" "$b"
    after_state="$(materialized_state "$b")"
    test "$before_state" = "$after_state"
    assert_overlay_fresh "$ledger" "$b" "ignored overlay idempotent hydration for $feature"
    cmp -s "$expected_exclude" "$exclude"
    test "$(cat "$exclude_peer")" = "${baseline_exclude%$'\n'}"
    note "PASS [ignored overlay]: exact multi-line exclude is preserved before four ordered managed patterns for $feature"
    note "PASS [ignored overlay]: exclude replacement does not write through a pre-existing hardlink for $feature"
    test "$(grep -cxF /AGENTS.local.md "$exclude")" -eq 1
    test "$(grep -cxF /CLAUDE.local.md "$exclude")" -eq 1
    test "$(grep -cxF /docs/agents/ "$exclude")" -eq 1
    test "$(grep -cxF /.slipway-local/ "$exclude")" -eq 1
    add_product_commit "$b" "${feature}-question" >/dev/null
    gitq -C "$b" push -qu origin "feature/$feature"
    note "Ignored overlay status for $feature: $(gitq -C "$b" status --short | tr '\n' ' ' || true)"
  done
  gitq -C "$b" worktree add -q -b feature/gamma "$base/linked-worktree" main
  hydrate_from_ledger "$ledger" "$base/linked-worktree"
  assert_overlay_fresh "$ledger" "$base/linked-worktree" 'ignored overlay linked-worktree hydration'
  test -z "$(gitq -C "$base/linked-worktree" status --short)"
  note 'PASS [ignored overlay]: linked worktree uses the clone-local exclude and its own hydrated files/version'
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
  printf '%s\n' '# unrelated ledger record' > "$ledger/.slipway/portfolio.md"
  gitq -C "$ledger" add .slipway/portfolio.md
  gitq -C "$ledger" commit -qm 'ledger: unrelated portfolio update'
  assert_overlay_fresh "$ledger" "$base/second-machine" 'ignored overlay ignores unrelated ledger commit'
  note 'PASS [ignored overlay]: unrelated ledger commit does not stale the overlay tree version'
  local prior_agent_peer prior_version_peer
  prior_agent_peer="$base/prior-agent-hardlink-peer"
  prior_version_peer="$base/prior-version-hardlink-peer"
  ln "$base/second-machine/AGENTS.local.md" "$prior_agent_peer"
  ln "$base/second-machine/.slipway-local/agent-overlay.version" "$prior_version_peer"
  printf '\n## Tool guidance\n\nUse CodeGraph when it is installed and the task needs structural exploration.\n' >> "$ledger/.slipway/agent-overlay/AGENTS.local.md"
  gitq -C "$ledger" add .slipway/agent-overlay/AGENTS.local.md
  gitq -C "$ledger" commit -qm 'ledger: add optional CodeGraph guidance'
  if overlay_is_fresh "$ledger" "$base/second-machine"; then
    note 'ASSERTION FAILED [ignored overlay]: stale second-machine overlay was not detected'
    exit 1
  fi
  note 'PASS [ignored overlay]: ledger version change makes the prior hydration detectably stale'
  local prior_version
  prior_version="$(cat "$base/second-machine/.slipway-local/agent-overlay.version")"
  hydrate_from_ledger "$ledger" "$base/second-machine"
  test "$prior_version" != "$(cat "$base/second-machine/.slipway-local/agent-overlay.version")"
  cmp -s "$ledger/.slipway/agent-overlay/AGENTS.local.md" "$base/second-machine/AGENTS.local.md"
  test "$(cat "$prior_version_peer")" = "$prior_version"
  ! cmp -s "$prior_agent_peer" "$base/second-machine/AGENTS.local.md"
  note 'PASS [ignored overlay]: stale file and version replacement do not write through hardlinks'
  note 'PASS [ignored overlay]: unchanged prior-version bytes safely advance to the new canonical tree'
  assert_overlay_fresh "$ledger" "$base/second-machine" 'ignored overlay stale recovery'

  local stale_fault_target stale_before stale_after stale_prior_version
  stale_fault_target="$base/stale-removal-fault"
  gitq clone -q "$base/repo-b-origin.git" "$stale_fault_target"
  gitq -C "$stale_fault_target" switch -q feature/beta
  hydrate_from_ledger "$ledger" "$stale_fault_target"
  stale_prior_version="$(cat "$stale_fault_target/.slipway-local/agent-overlay.version")"
  stale_before="$(materialized_state "$stale_fault_target")"

  gitq -C "$ledger" mv \
    .slipway/agent-overlay/docs/agents/domain.md \
    .slipway/agent-overlay/docs/agents/domain-policy.md
  gitq -C "$ledger" commit -qm 'ledger: rename private domain guidance'

  if SLIPWAY_OVERLAY_FAULT_AFTER_INSTALL=1 hydrate_from_ledger "$ledger" "$stale_fault_target"; then
    note 'ASSERTION FAILED [ignored overlay]: stale-removal fault injection did not fail'
    exit 1
  fi
  stale_after="$(materialized_state "$stale_fault_target")"
  test "$stale_before" = "$stale_after"
  test -f "$stale_fault_target/docs/agents/domain.md"
  test ! -e "$stale_fault_target/docs/agents/domain-policy.md"
  test "$(cat "$stale_fault_target/.slipway-local/agent-overlay.version")" = "$stale_prior_version"
  note 'PASS [ignored overlay]: stale removal/install fault restores prior managed paths, bytes, version, and full exclude'

  hydrate_from_ledger "$ledger" "$base/second-machine"
  test ! -e "$base/second-machine/docs/agents/domain.md"
  test -f "$base/second-machine/docs/agents/domain-policy.md"
  test "$(cat "$base/second-machine/.slipway-local/agent-overlay.version")" = "$(gitq -C "$ledger" rev-parse HEAD:.slipway/agent-overlay)"
  assert_overlay_fresh "$ledger" "$base/second-machine" 'ignored overlay stale path-removal recovery'
  note 'PASS [ignored overlay]: baseline-owned stale path is removed and renamed policy reaches the exact new tree'

  change_delivery_agents_and_sync "$a" "$b"
  hydrate_from_ledger "$ledger" "$b"
  assert_overlay_fresh "$ledger" "$b" 'ignored overlay after Repo-B main sync'
  show_state "$b" 'ignored overlay after Repo-A AGENTS change + Repo-B main sync'
}

metadata_strategy
overlay_branch_strategy
ignored_overlay_strategy
bash "$ROOT_DIR/verify-contract.sh" --self-test
bash "$ROOT_DIR/verify-contract.sh"

say 'Result'
note "All three strategies passed cargo isolation. Disposable repositories retained at: $WORK_DIR"
note 'Read each state block above: committed strategies expose private files in Repo-B history; ignored strategy requires explicit hydration.'
note "Evidence log: $WORK_DIR/evidence.log"
