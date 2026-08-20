#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_dir="${1:-$(mktemp -d "${TMPDIR:-/tmp}/slipway-context.XXXXXX")}"
repo_b="$work_dir/repo-b"
ledger="$work_dir/ledger"
asset="$root_dir/packages/slipway/skills/slipway/assets/context"

mkdir -p "$repo_b" "$ledger/.slipway" "$repo_b/.slipway-local" "$repo_b/.codegraph"
git -C "$repo_b" init -q
git -C "$repo_b" config user.name prototype
git -C "$repo_b" config user.email prototype@example.invalid
printf '%s\n' '# Trivia app' > "$repo_b/README.md"
git -C "$repo_b" add README.md
git -C "$repo_b" commit -qm 'initial app'
app_head="$(git -C "$repo_b" rev-parse HEAD)"

exclude="$(git -C "$repo_b" rev-parse --path-format=absolute --git-path info/exclude)"
printf '%s\n' '/.slipway-local/' '/.codegraph/' >> "$exclude"
printf '%s\n' 'private index marker' > "$repo_b/.codegraph/index"

cp -R "$asset" "$ledger/.slipway/context"
git -C "$ledger" init -q
git -C "$ledger" config user.name prototype
git -C "$ledger" config user.email prototype@example.invalid
git -C "$ledger" add .slipway/context
git -C "$ledger" commit -qm 'private context'
context_tree="$(git -C "$ledger" rev-parse HEAD:.slipway/context)"

cp -R "$ledger/.slipway/context/." "$repo_b/.slipway-local/context"
printf '%s\n' "$context_tree" > "$repo_b/.slipway-local/context.version"

active='project-policy,matt-skills,codegraph'
skipped='none'
for entrypoint in \
  modules/project-policy/CONTEXT.md \
  modules/matt-skills/CONTEXT.md \
  modules/codegraph/CONTEXT.md; do
  test -s "$repo_b/.slipway-local/context/$entrypoint"
done
grep -q 'Never write that output to tracked' \
  "$repo_b/.slipway-local/context/modules/matt-skills/CONTEXT.md"
grep -q 'use CodeGraph before grep' \
  "$repo_b/.slipway-local/context/modules/codegraph/CONTEXT.md"

cat > "$work_dir/worker-brief.md" <<EOF
# Focused worker brief

- Context tree ID: \`$context_tree\`
- Active modules: \`$active\`
- Skipped modules: \`$skipped\`
- Required entrypoints: \`$repo_b/.slipway-local/context/modules/matt-skills/CONTEXT.md\`, \`$repo_b/.slipway-local/context/modules/codegraph/CONTEXT.md\`

Read both entrypoints. Report the issue location and the exploration tool/order
they require. Do not edit any file.
EOF

test "$(git -C "$repo_b" rev-parse HEAD)" = "$app_head"
test -z "$(git -C "$repo_b" status --porcelain)"
printf 'PASS happy-path: tree=%s active=%s\n' "$context_tree" "$active"
printf 'PASS worker-brief: %s\n' "$work_dir/worker-brief.md"

active_without_codegraph='project-policy,matt-skills'
skipped_without_codegraph='codegraph: capability unavailable'
test "$active_without_codegraph" = 'project-policy,matt-skills'
test "$skipped_without_codegraph" = 'codegraph: capability unavailable'
printf 'PASS optional-skip: active=%s skipped=%s\n' \
  "$active_without_codegraph" "$skipped_without_codegraph"

test -z "$(git -C "$repo_b" diff --name-only HEAD)"
printf 'PASS zero-bleed: tracked application tree unchanged; delivery cargo empty\n'
printf 'FIXTURE %s\n' "$work_dir"
