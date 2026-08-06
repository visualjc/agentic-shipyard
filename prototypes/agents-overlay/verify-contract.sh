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

case "${1:-}" in
  --self-test)
    self_test
    ;;
  *)
    check_contract "$TARGET_ROOT"
    ;;
esac
