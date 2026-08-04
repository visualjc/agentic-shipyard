# Independent review

`shipyard-review` requests an independent Codex v1 review for one recorded
candidate SHA. Shipyard validates the current acceptance, review intent, and
candidate facts before dispatch and records the result through its governed
operation.

Any changed candidate, changed review input, or accepted finding requires a
fresh governed review path. External approvals and task checkboxes are useful
observations but never replace the exact-SHA evidence gate.

Review does not implement, promote, finalize, or merge work. Next safe action:
run `shipyard-review` for the exact recorded candidate and follow its result.
