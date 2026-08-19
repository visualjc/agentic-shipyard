#!/usr/bin/env bash
# PROTOTYPE — contract-polarity regression verifier. Not product code.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_ROOT="${1:-$ROOT_DIR}"

normalize_file() {
  awk '
    function emit_paragraph() {
      if (paragraph != "") { print "| " paragraph; paragraph = "" }
    }
    BEGIN { paragraph = "" }
    /^[[:space:]]*$/ {
      emit_paragraph()
      next
    }
    {
      line = $0
      if (line ~ /^[[:space:]]*[-+*][[:space:]]+/ ||
          line ~ /^[[:space:]]*[0-9]+[.)][[:space:]]+/) {
        emit_paragraph()
        sub(/^[[:space:]]*[-+*][[:space:]]+/, "", line)
        sub(/^[[:space:]]*[0-9]+[.)][[:space:]]+/, "", line)
        sub(/^\[[ xX]\][[:space:]]+/, "", line)
      }
      gsub(/[`*_]/, "", line)
      gsub(/[[:space:]]+/, " ", line)
      sub(/^ /, "", line)
      sub(/ $/, "", line)
      paragraph = paragraph (paragraph == "" ? "" : " ") line
    }
    END { emit_paragraph() }
  ' "$1" | tr '[:upper:]' '[:lower:]'
}

inspect_private_history_range() {
  local repo="$1" base="$2" head="$3" label="${4:-history range}"
  local commit path content failed=0
  local private_policy_pattern
  private_policy_pattern='(\.slipway-local/binding\.md|github[[:space:]]+(user|account|login|identity)|provider[ -]identity|private[[:space:]]+repo-b[[:space:]]+agent[[:space:]]+overlay|needs-triage|needs-info|ready-for-agent|ready-for-human)'

  if ! git -C "$repo" rev-parse --verify "$base^{commit}" >/dev/null 2>&1 ||
     ! git -C "$repo" rev-parse --verify "$head^{commit}" >/dev/null 2>&1 ||
     ! git -C "$repo" merge-base --is-ancestor "$base" "$head"; then
    printf 'FAIL [%s]: base/head are not a valid ancestor range\n' "$label"
    return 1
  fi

  while IFS= read -r commit; do
    while IFS= read -r path; do
      test -n "$path" || continue
      case "$path" in
        AGENTS.local.md|CLAUDE.local.md|docs/agents|docs/agents/*|.slipway-local|.slipway-local/*)
          printf 'FAIL [%s]: private root path appears in commit %s: %s\n' \
            "$label" "$(git -C "$repo" rev-parse --short "$commit")" "$path"
          failed=1
          ;;
      esac

      case "$path" in
        AGENTS.md|CLAUDE.md|*/AGENTS.md|*/CLAUDE.md|.github/copilot-instructions.md|.cursor/rules/*)
          content="$(git -C "$repo" show "$commit:$path" 2>/dev/null || true)"
          if test -n "$content" && printf '%s\n' "$content" | grep -Eiq "$private_policy_pattern"; then
            printf 'FAIL [%s]: private policy content appears in changed public instruction file at %s: %s\n' \
              "$label" "$(git -C "$repo" rev-parse --short "$commit")" "$path"
            failed=1
          fi
          ;;
      esac
    done < <(git -C "$repo" diff-tree --root -m --no-commit-id --name-only -r "$commit" | sort -u)
  done < <(git -C "$repo" rev-list --reverse "$base..$head")

  if test "$failed" -eq 0; then
    printf 'PASS [%s]: every commit/tree in the range is free of private root metadata and instruction policy\n' "$label"
  fi
  return "$failed"
}

check_dry_run_conformance() {
  local root="$1"
  local asset="$root/packages/slipway/skills/slipway/assets/run-status.md"
  local canonical_manifest="$root/packages/slipway/skills/slipway/assets/agent-overlay/manifest.md"
  local fixture_manifest="$root/packages/slipway/examples/dry-run/ledger/.slipway/agent-overlay/manifest.md"
  local status health action health_count action_count health_line action_line status_count failed=0
  local canonical_normalized fixture_normalized

  if test ! -f "$asset" || test ! -f "$canonical_manifest" || test ! -f "$fixture_manifest"; then
    printf 'FAIL [dry-run-conformance]: canonical status or manifest asset is missing\n'
    return 1
  fi

  if test "$(grep -c '^- Worktree overlay health:' "$asset" || true)" -ne 1 ||
     test "$(grep -c '^- Worktree overlay action:' "$asset" || true)" -ne 1 ||
     test "$(( $(grep -n '^- Worktree overlay health:' "$asset" | cut -d: -f1) + 1 ))" \
       -ne "$(grep -n '^- Worktree overlay action:' "$asset" | cut -d: -f1)"; then
    printf 'FAIL [dry-run-conformance]: run-status asset does not define exactly ordered health+action fields\n'
    failed=1
  fi

  status_count=0
  while IFS= read -r status; do
    status_count=$((status_count + 1))
    health_count="$(grep -c '^- Worktree overlay health:' "$status" || true)"
    action_count="$(grep -c '^- Worktree overlay action:' "$status" || true)"
    health_line="$(grep -n '^- Worktree overlay health:' "$status" | cut -d: -f1 || true)"
    action_line="$(grep -n '^- Worktree overlay action:' "$status" | cut -d: -f1 || true)"
    if test "$health_count" -ne 1 || test "$action_count" -ne 1 ||
       test -z "$health_line" || test -z "$action_line" ||
       test "$((health_line + 1))" -ne "$action_line"; then
      printf 'FAIL [dry-run-conformance]: %s must contain exactly health then action on adjacent lines\n' \
        "${status#"$root/"}"
      failed=1
      continue
    fi
    health="$(sed -n 's/^- Worktree overlay health: `\([^`]*\)`.*/\1/p' "$status")"
    action="$(sed -n 's/^- Worktree overlay action: `\([^`]*\)`.*/\1/p' "$status")"
    case "$health:$action" in
      healthy:none|missing:hydrate|stale:hydrate|divergent:repair|unexpected:repair|tracked:repair|invalid:repair)
        ;;
      *)
        printf 'FAIL [dry-run-conformance]: invalid overlay health/action mapping in %s: %s -> %s\n' \
          "${status#"$root/"}" "${health:-<invalid>}" "${action:-<invalid>}"
        failed=1
        ;;
    esac
  done < <(find "$root/packages/slipway/examples/dry-run/ledger/.slipway/runs" -type f -name status.md | sort)
  if test "$status_count" -eq 0; then
    printf 'FAIL [dry-run-conformance]: no derived dry-run status fixtures were found\n'
    failed=1
  fi

  # Purpose text describes the source context (product asset versus synthetic
  # dry-run fixture); every behavioral contract line must otherwise match.
  canonical_normalized="$(normalize_file "$canonical_manifest" | grep -v '^| purpose:')"
  fixture_normalized="$(normalize_file "$fixture_manifest" | grep -v '^| purpose:')"
  if [[ "$canonical_normalized" != *'| format: slipway-agent-overlay/v1'* ]] ||
     [[ "$canonical_normalized" != *'| agents.local.md'* ]] ||
     [[ "$canonical_normalized" != *'| claude.local.md'* ]] ||
     [[ "$canonical_normalized" != *'| docs/agents/'* ]] ||
     [[ "$canonical_normalized" != *'every resolved file must be regular, relative to the overlay root, non-empty, and free of ./.. traversal'* ]] ||
     [[ "$canonical_normalized" != *'docs/agents/ is an allowlisted path pattern, not itself a file'* ]] ||
     [[ "$canonical_normalized" != *'manifest.md is ledger metadata, not a materialized repo-b file'* ]]; then
    printf 'FAIL [dry-run-conformance]: canonical v1 manifest is missing a required path/type/content/traversal/pattern rule\n'
    failed=1
  elif test "$fixture_normalized" != "$canonical_normalized"; then
    printf 'FAIL [dry-run-conformance]: synthetic overlay manifest has drifted semantically from the canonical v1 asset\n'
    failed=1
  fi

  if test "$failed" -eq 0; then
    printf 'PASS [dry-run-conformance]: status schemas/mappings and normalized v1 manifest are canonical\n'
  fi
  return "$failed"
}

check_contract() {
  local root="$1" id file required forbidden normalized i
  local -a ids=(
    public-contract-negative-polarity
    hidden-index-flags-prohibited
    materialized-root-overlay-cargo-rejected
  )
  local -a files=(
    packages/slipway/skills/slipway/references/setup.md
    packages/slipway/skills/slipway/references/store.md
    packages/slipway/skills/slipway/references/delivery-gate.md
  )
  local -a required_patterns=(
    "it must not name slipway.s repository topology, a private skill, or private policy"
    "never use skip-worktree or assume-unchanged"
    "reject materialized worktree-root /agents.local.md, /claude.local.md, /docs/agents/, and /.slipway-local/"
  )
  local -a forbidden_patterns=(
    "(^|[|;.!?][[:space:]]+)it must name slipway.s repository topology, a private skill, or private policy"
    "(^|[|;.!?][[:space:]]+)use skip-worktree or assume-unchanged"
    "(^|[|;.!?][[:space:]]+)allow materialized worktree-root /agents.local.md"
  )
  local failed=0

  for ((i = 0; i < ${#ids[@]}; i++)); do
    id="${ids[$i]}"
    file="$root/${files[$i]}"
    if [[ ! -f "$file" ]]; then
      printf 'FAIL [%s]: missing %s\n' "$id" "${files[$i]}"
      failed=1
      continue
    fi
    normalized="$(normalize_file "$file")"
    required="${required_patterns[$i]}"
    forbidden="${forbidden_patterns[$i]}"
    if [[ ! "$normalized" =~ $required ]]; then
      printf 'FAIL [%s]: required negative contract paragraph is absent\n' "$id"
      failed=1
    elif [[ "$normalized" =~ $forbidden ]]; then
      printf 'FAIL [%s]: known inverted/positive contract variant is present\n' "$id"
      failed=1
    else
      printf 'PASS [%s]\n' "$id"
    fi
  done

  return "$failed"
}

self_test() {
  local fixture file i j result
  fixture="$(mktemp -d "${TMPDIR:-/tmp}/slipway-contract-polarity.XXXXXX")"
  trap 'rm -rf "$fixture"' RETURN
  mkdir -p "$fixture/packages/slipway/skills/slipway/references"
  cp "$ROOT_DIR/packages/slipway/skills/slipway/references/setup.md" "$fixture/packages/slipway/skills/slipway/references/setup.md"
  cp "$ROOT_DIR/packages/slipway/skills/slipway/references/store.md" "$fixture/packages/slipway/skills/slipway/references/store.md"
  cp "$ROOT_DIR/packages/slipway/skills/slipway/references/delivery-gate.md" "$fixture/packages/slipway/skills/slipway/references/delivery-gate.md"

  local -a names=(public-contract hidden-index cargo)
  local -a ids=(
    public-contract-negative-polarity
    hidden-index-flags-prohibited
    materialized-root-overlay-cargo-rejected
  )
  local -a paths=(
    packages/slipway/skills/slipway/references/setup.md
    packages/slipway/skills/slipway/references/store.md
    packages/slipway/skills/slipway/references/delivery-gate.md
  )
  local -a positive_variants=(
    "it must name Slipway's repository topology, a private skill, or private policy"
    "Use \`skip-worktree\` or \`assume-unchanged\`."
    "Allow materialized worktree-root \`/AGENTS.local.md\`."
  )
  local -a task_first=(
    "it must name Slipway's repository topology,"
    "Use \`skip-worktree\` or"
    "Allow materialized worktree-root"
  )
  local -a task_second=(
    "a private skill, or private policy"
    "\`assume-unchanged\`."
    "\`/AGENTS.local.md\`."
  )
  local -a form_names=(exact-bullet soft-wrapped-task-list mid-paragraph-clause)

  for ((i = 0; i < ${#names[@]}; i++)); do
    file="$fixture/${paths[$i]}"
    for ((j = 0; j < ${#form_names[@]}; j++)); do
      cp "$ROOT_DIR/${paths[$i]}" "$file"
      case "${form_names[$j]}" in
        exact-bullet)
          printf '\n- %s\n' "${positive_variants[$i]}" >> "$file"
          ;;
        soft-wrapped-task-list)
          printf '\n- [x] %s\n  %s\n' "${task_first[$i]}" "${task_second[$i]}" >> "$file"
          ;;
        mid-paragraph-clause)
          printf '\nThe required negative contract remains; %s\n' "${positive_variants[$i]}" >> "$file"
          ;;
      esac
      if result="$(check_contract "$fixture" 2>&1)"; then
        printf 'FAIL [self-test %s/%s]: contradictory fixture unexpectedly passed\n' "${names[$i]}" "${form_names[$j]}"
        return 1
      fi
      if [[ "$result" != *"FAIL [${ids[$i]}]: known inverted/positive contract variant is present"* ]]; then
        printf 'FAIL [self-test %s/%s]: fixture failed for the wrong reason\n' "${names[$i]}" "${form_names[$j]}"
        printf '%s\n' "$result"
        return 1
      fi
      printf 'PASS [self-test %s/%s]: forbidden matcher rejects contradictory variant\n' "${names[$i]}" "${form_names[$j]}"
    done
  done

  local -a negative_variants=(
    "It must not name Slipway's repository topology, a private skill, or private policy."
    "Do not use \`skip-worktree\` or \`assume-unchanged\`."
    "Do not allow materialized worktree-root \`/AGENTS.local.md\`."
  )
  for ((i = 0; i < ${#names[@]}; i++)); do
    file="$fixture/${paths[$i]}"
    cp "$ROOT_DIR/${paths[$i]}" "$file"
    printf '\n- [ ] %s\n' "${negative_variants[$i]}" >> "$file"
  done
  if ! result="$(check_contract "$fixture" 2>&1)"; then
    printf 'FAIL [self-test correct-negative-phrases]: valid negative variants were rejected\n'
    printf '%s\n' "$result"
    return 1
  fi
  printf 'PASS [self-test correct-negative-phrases]: must-not and do-not variants avoid false positives\n'
}

self_test_history_range() {
  local fixture base clean result
  fixture="$(mktemp -d "${TMPDIR:-/tmp}/slipway-history-range.XXXXXX")"
  git -C "$fixture" init -q -b main
  git -C "$fixture" config user.name 'Contract Test'
  git -C "$fixture" config user.email 'contract@example.test'
  printf '%s\n' '# Public instructions' > "$fixture/AGENTS.md"
  printf '%s\n' '# Fixture' > "$fixture/README.md"
  git -C "$fixture" add AGENTS.md README.md
  git -C "$fixture" commit -qm 'fixture: establish public base'
  base="$(git -C "$fixture" rev-parse HEAD)"

  printf '%s\n' 'clean product change' >> "$fixture/README.md"
  git -C "$fixture" add README.md
  git -C "$fixture" commit -qm 'fixture: add clean product change'
  clean="$(git -C "$fixture" rev-parse HEAD)"
  if ! result="$(inspect_private_history_range "$fixture" "$base" "$clean" 'self-test clean history' 2>&1)"; then
    printf 'FAIL [self-test history-range/clean]: clean range was rejected\n%s\n' "$result"
    rm -rf -- "$fixture"
    return 1
  fi
  printf 'PASS [self-test history-range/clean]: clean range is accepted\n'

  git -C "$fixture" switch -qc transient-path "$clean"
  printf '%s\n' 'private guidance' > "$fixture/AGENTS.local.md"
  git -C "$fixture" add AGENTS.local.md
  git -C "$fixture" commit -qm 'fixture: accidentally commit private root metadata'
  git -C "$fixture" rm -q AGENTS.local.md
  git -C "$fixture" commit -qm 'fixture: delete private root metadata'
  if result="$(inspect_private_history_range "$fixture" "$base" HEAD 'self-test transient private path' 2>&1)"; then
    printf 'FAIL [self-test history-range/path]: added-then-deleted private path escaped inspection\n'
    rm -rf -- "$fixture"
    return 1
  fi
  if [[ "$result" != *'private root path appears in commit'* ]]; then
    printf 'FAIL [self-test history-range/path]: transient path failed for the wrong reason\n%s\n' "$result"
    rm -rf -- "$fixture"
    return 1
  fi
  printf 'PASS [self-test history-range/path]: added-then-deleted private root metadata is rejected\n'

  git -C "$fixture" switch -qc transient-policy "$clean"
  printf '%s\n' 'GitHub account: example-private-user' >> "$fixture/AGENTS.md"
  git -C "$fixture" add AGENTS.md
  git -C "$fixture" commit -qm 'fixture: accidentally publish private provider policy'
  git -C "$fixture" show "$clean:AGENTS.md" > "$fixture/AGENTS.md"
  git -C "$fixture" add AGENTS.md
  git -C "$fixture" commit -qm 'fixture: delete private provider policy'
  if result="$(inspect_private_history_range "$fixture" "$base" HEAD 'self-test transient private policy' 2>&1)"; then
    printf 'FAIL [self-test history-range/policy]: added-then-deleted private instruction policy escaped inspection\n'
    rm -rf -- "$fixture"
    return 1
  fi
  if [[ "$result" != *'private policy content appears in changed public instruction file'* ]]; then
    printf 'FAIL [self-test history-range/policy]: transient policy failed for the wrong reason\n%s\n' "$result"
    rm -rf -- "$fixture"
    return 1
  fi
  printf 'PASS [self-test history-range/policy]: added-then-deleted private instruction policy is rejected\n'
  rm -rf -- "$fixture"
}

self_test_dry_run_conformance() {
  local fixture source_status target_status result temp_file
  fixture="$(mktemp -d "${TMPDIR:-/tmp}/slipway-dry-run-conformance.XXXXXX")"
  mkdir -p \
    "$fixture/packages/slipway/skills/slipway/assets/agent-overlay" \
    "$fixture/packages/slipway/examples/dry-run/ledger/.slipway/agent-overlay" \
    "$fixture/packages/slipway/examples/dry-run/ledger/.slipway/runs/feature/example"
  cp "$ROOT_DIR/packages/slipway/skills/slipway/assets/run-status.md" \
    "$fixture/packages/slipway/skills/slipway/assets/run-status.md"
  cp "$ROOT_DIR/packages/slipway/skills/slipway/assets/agent-overlay/manifest.md" \
    "$fixture/packages/slipway/skills/slipway/assets/agent-overlay/manifest.md"
  cp "$ROOT_DIR/packages/slipway/examples/dry-run/ledger/.slipway/agent-overlay/manifest.md" \
    "$fixture/packages/slipway/examples/dry-run/ledger/.slipway/agent-overlay/manifest.md"
  source_status="$(find "$ROOT_DIR/packages/slipway/examples/dry-run/ledger/.slipway/runs" -type f -name status.md | sort | head -n 1)"
  target_status="$fixture/packages/slipway/examples/dry-run/ledger/.slipway/runs/feature/example/status.md"
  cp "$source_status" "$target_status"

  if ! result="$(check_dry_run_conformance "$fixture" 2>&1)"; then
    printf 'FAIL [self-test dry-run/baseline]: canonical fixture was rejected\n%s\n' "$result"
    rm -rf -- "$fixture"
    return 1
  fi
  printf 'PASS [self-test dry-run/baseline]: canonical fixture is accepted\n'

  temp_file="$fixture/status.tmp"
  sed 's/Worktree overlay action: `none`/Worktree overlay action: `repair`/' "$target_status" > "$temp_file"
  mv "$temp_file" "$target_status"
  if result="$(check_dry_run_conformance "$fixture" 2>&1)"; then
    printf 'FAIL [self-test dry-run/mapping]: invalid healthy-to-repair mapping was accepted\n'
    rm -rf -- "$fixture"
    return 1
  fi
  if [[ "$result" != *'invalid overlay health/action mapping'* ]]; then
    printf 'FAIL [self-test dry-run/mapping]: invalid mapping failed for the wrong reason\n%s\n' "$result"
    rm -rf -- "$fixture"
    return 1
  fi
  printf 'PASS [self-test dry-run/mapping]: invalid health/action mapping is rejected\n'
  cp "$source_status" "$target_status"

  temp_file="$fixture/manifest.tmp"
  sed 's/non-empty, and/free of empty content and/' \
    "$fixture/packages/slipway/examples/dry-run/ledger/.slipway/agent-overlay/manifest.md" > "$temp_file"
  mv "$temp_file" "$fixture/packages/slipway/examples/dry-run/ledger/.slipway/agent-overlay/manifest.md"
  if result="$(check_dry_run_conformance "$fixture" 2>&1)"; then
    printf 'FAIL [self-test dry-run/manifest]: semantically drifted fixture manifest was accepted\n'
    rm -rf -- "$fixture"
    return 1
  fi
  if [[ "$result" != *'synthetic overlay manifest has drifted semantically'* ]]; then
    printf 'FAIL [self-test dry-run/manifest]: manifest drift failed for the wrong reason\n%s\n' "$result"
    rm -rf -- "$fixture"
    return 1
  fi
  printf 'PASS [self-test dry-run/manifest]: normalized manifest drift is rejected\n'
  rm -rf -- "$fixture"
}

check_current_candidate_history() {
  local root="$1" base_ref='' base
  if ! git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
    printf 'SKIP [candidate history]: target root is not a Git worktree\n'
    return 0
  fi
  if test -n "${SLIPWAY_CANDIDATE_BASE_REF:-}" &&
     git -C "$root" rev-parse --verify "$SLIPWAY_CANDIDATE_BASE_REF^{commit}" >/dev/null 2>&1; then
    base_ref="$SLIPWAY_CANDIDATE_BASE_REF"
  elif git -C "$root" rev-parse --verify refs/heads/main^{commit} >/dev/null 2>&1; then
    base_ref=refs/heads/main
  elif git -C "$root" rev-parse --verify refs/remotes/origin/main^{commit} >/dev/null 2>&1; then
    base_ref=refs/remotes/origin/main
  else
    printf 'SKIP [candidate history]: no local or origin main ref is available\n'
    return 0
  fi
  base="$(git -C "$root" merge-base "$base_ref" HEAD)"
  inspect_private_history_range "$root" "$base" HEAD 'candidate history'
}

case "${1:-}" in
  --self-test)
    self_test
    self_test_history_range
    self_test_dry_run_conformance
    ;;
  *)
    check_contract "$TARGET_ROOT"
    check_dry_run_conformance "$TARGET_ROOT"
    check_current_candidate_history "$TARGET_ROOT"
    ;;
esac
