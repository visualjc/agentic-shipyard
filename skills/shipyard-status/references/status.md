# Status reference

`shipyard-status` is read-only. It reports the binding, selected-lane
dependency state, discovery duplicates, and a sanitized next safe action.
Ready means the tested receipt and Codex v1 host match exactly. Missing,
modified, duplicate, incompatible, and unverified dependencies block the lane;
Shipyard never updates or repairs them.

Claude Code and Cursor/Pstack are deferred and unsupported in v1. Next safe
action: run the command returned by `shipyard-status`.
