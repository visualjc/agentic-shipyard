# CCPM storage decision for Shipyard bootstrap

Reviewed pin: `visualjc/ccpm@cdb97474904ab2cdc7d391aa17393b444a28be3e`

## Finding

The reviewed CCPM skill has no configurable project-data root. `SKILL.md`
explicitly says CCPM stores state in `.claude/` regardless of host installation,
and 23 files under `skill/ccpm` contain hardcoded `.claude/` paths. No
`CCPM_ROOT`, `CCPM_DIR`, `CCPM_PATH`, data-directory option, or equivalent
resolver exists at this pin.

## Bootstrap behavior

Shipyard stores the canonical files at:

```text
shipyard/ccpm/
```

on the development-only `shipyard-ledger` branch. The product checkout contains
an ignored machine-local symlink:

```text
.claude -> <ledger-worktree>/shipyard/ccpm
```

CCPM therefore sees its required `.claude` path while its physical files land
in the ledger. The bridge fails closed unless product and ledger share one Git
common directory, the product origin is exactly the VisualJC development
repository, no extra remote exists, and each worktree is on its expected branch.

Raw CCPM GitHub sync is not used. The guarded bootstrap synchronizer reads the
same records, verifies the scoped actor and exact development repository, and
creates resumable marker-tagged issues only there.

## Future CCPM improvement

A clean upstream/fork change would introduce one data-root resolver, for example
`CCPM_DATA_DIR`, defaulting to `.claude` for compatibility. Every reference and
script would consume that resolved value rather than embedding `.claude/`.
Documentation/frontmatter paths would use the resolved project-relative root,
and deterministic scripts would gain tests for default, relative custom, and
absolute custom roots.

That dependency change should be reviewed and released separately. Shipyard v1
does not silently patch the pinned CCPM source during bootstrap.
