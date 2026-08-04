# Codex skill discovery

The canonical Shipyard skill packages live in `skills/<name>`. A source checkout
has `.agents/skills/<name>` symlinks to those packages; npm intentionally does
not ship those symlinks. There are no duplicate physical skill definitions.
Each package has `SKILL.md` and optional Codex invocation metadata at
`agents/openai.yaml`.

After installing from npm, create the official discovery symlinks with the
packaged installer (it refuses to overwrite files, directories, or a symlink
to a different target):

```sh
shipyard-skills-install --target /path/to/project
shipyard-skills-install --home "$HOME"
```

Either command installs all four packages. `--target` defaults to the current
directory when neither option is given. Do not install a second package with
the same name: Codex may select a different discovered definition. Verify the layout with:

```sh
readlink "$REPO_ROOT/.agents/skills/shipyard"
readlink /path/to/project/.agents/skills/shipyard
test -f "$HOME/.agents/skills/shipyard/agents/openai.yaml"
```
