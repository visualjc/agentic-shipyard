# Dependency verification

The dependency-verification probe used by `shipyard-setup` and
`shipyard-status` may inspect the fixed canonical `~/.agents/skills`
installation and its maintenance receipt. That probe never installs, relinks,
vendors, updates, deletes, acquires a mutation lock, invokes Git/GitHub, or
dispatches an agent.

Those limits describe the dependency probe, not every step of the surrounding
commands. `shipyard-status` remains read-only but resolves the binding and may
perform its documented bounded local Git reads. `shipyard-setup` first resolves
the repository's Git common-directory identity and validates its declared
remotes. After the dependency gate passes, setup acquires the governed
repository and binding-store mutation locks before persisting the binding. A
dependency blocker stops setup before either mutation lock or binding write.

Shipyard v1 accepts only the reviewed Matt 20-skill receipt, the reviewed CCPM receipt, and Codex `0.144.4`. A changed source/runtime is **unverified**; changed local content is **modified**; a missing or duplicate discovery definition blocks the selected lane. Repair is owned by the dependency's existing maintenance workflow, not Shipyard.

The observation is bounded: it follows no content-tree symlink, reads limited files, accepts a small frontmatter document, and runs only the fixed host executable with `--version` under a short timeout. A receipt is evidence, never authority to write a provider, repository, ledger, or profile.

## Reviewed planning host

Live classification also requires a reviewed machine-local file at
`$SHIPYARD_HOME/planning-host.json` with exactly these fields:

```json
{
  "executable": "/absolute/path/to/codex",
  "runtimePath": "/usr/local/bin:/usr/bin:/bin",
  "codeHome": "/absolute/path/to/dedicated-reviewed-codex-home"
}
```

`executable` and `codeHome` must be absolute, non-root paths. Every
colon-separated entry in `runtimePath` must also be an absolute, non-root path.
`codeHome` becomes the child process's dedicated `CODEX_HOME`; authenticate
that home beforehand through the normal Codex login flow, then review it as
part of the local host composition. The JSON contains paths only: never put a
token, credential, account selector, model, prompt, or arbitrary argument in
it. Shipyard does not fall back to an ambient `CODEX_HOME`, user configuration,
or an inferred planning executable.

The supported host is exactly `codex-cli 0.144.4`. Shipyard fixes the live
classifier to `gpt-5.6-terra` with medium reasoning, a read-only sandbox, and
an ephemeral process; these are code-owned settings rather than configurable
JSON fields. Setup and status perform only bounded `--version` probes and do
not run classification. A missing or malformed file, inaccessible path, wrong
version, extra field, or otherwise incompatible host blocks planning with
specific setup/status guidance.
