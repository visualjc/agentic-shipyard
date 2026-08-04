# Metadata ownership

Every path later delivered by Shipyard must have exactly one policy owner:
product, development-record, development-generated, destination-only,
context-overlay, or scratch. Unclassified and conflicting paths block mutation.
The setup/status/help commands do not classify or publish files.

Experimental graph caches are machine-local scratch. Graphify output must be
relocated to a private external cache; CodeGraph's worktree-local `.codegraph/`
is excluded only through that worktree's Git `info/exclude`, never tracked
`.gitignore`. Understand Anything has no authoritative feature-worktree state
in v1.
