# Codex skill discovery

The canonical Shipyard skill packages live in `skills/<name>`. Codex discovers
the repository packages through `.agents/skills/<name>`, which is a symlink to
the canonical package; there are no duplicate physical skill definitions.
Each package has `SKILL.md` and optional Codex invocation metadata at
`agents/openai.yaml`.

To make a package available to one user, create a symlink rather than copying
it (replace `REPO_ROOT` with this checkout):

```sh
mkdir -p "$HOME/.agents/skills"
ln -s "$REPO_ROOT/skills/shipyard" "$HOME/.agents/skills/shipyard"
```

Repeat for the focused `shipyard-setup`, `shipyard-status`, and `shipyard-help`
packages as needed. Do not install a second package with the same name: Codex
may select a different discovered definition. Verify the layout with:

```sh
readlink "$REPO_ROOT/.agents/skills/shipyard"
readlink "$HOME/.agents/skills/shipyard"
test -f "$HOME/.agents/skills/shipyard/agents/openai.yaml"
```
