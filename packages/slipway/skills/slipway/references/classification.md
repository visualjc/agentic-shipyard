# Effort classification

Classify from observable scope and uncertainty. State the evidence and the next route before execution.

Treat this matrix as the authoritative lane registry. Use its playbook and preflight every listed capability immediately before lane execution.

| Lane | Select when | Playbook | Required capabilities |
| --- | --- | --- | --- |
| `tiny-change` | Intent and acceptance are settled, risk is local, one product commit is credible, and the user permits the shortcut. | `tiny-change.md` | `implement`, `tdd`, Git/provider access for agentic PR, `code-review` |
| `small-development` | One bounded product outcome can be settled in one grilling session and implemented from a short ticket frontier. | `small-development.md` | `grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `tdd`, Git/provider access for agentic PR, `code-review` |
| `large-development` | The effort spans sessions or components and contains unresolved product, domain, or architecture decisions. | `large-development.md` | `wayfinder`, `to-spec`, `to-tickets`, configured build provider, `tdd`, Git/provider access for agentic PR, `code-review`; add `research` or `prototype` when selected |
| `bug-investigation` | Something is reported broken and the first incorrect boundary is not proven. | `bug-investigation.md` | `diagnosing-bugs`; add `triage` only for raw non-agent-ready intake |
| `bug-fix` | `diagnosing-bugs` has recorded a bounded reproduced regression and its first incorrect boundary. | `bug-fix.md` | completed `diagnosing-bugs` result, `implement`, `tdd`, Git/provider access for agentic PR, `code-review` |
| `review-only` | The user requests assessment without implementation. | `review-only.md` | `code-review` plus repository verification |
| `delivery-follow-up` | Feedback or failing checks belong to an existing delivery PR. | `delivery-follow-up.md` | Git/provider access, classification target capabilities, `code-review` |
| `research-prototype` | A factual question or one design uncertainty blocks a decision. | `research-prototype.md` | `research` and/or `prototype` as selected |
| `session-continuity` | The request pauses or resumes a known run. | `session-continuity.md` | Git and Slipway records |
| `promotion` | An exact reviewed agentic candidate and agentic PR are ready for delivery preflight. | `promotion.md` | Git/provider access and project cargo policy |
| `synchronization` | Authoritative delivery main must fast-forward agentic main, then the agentic PR must close without merge. | synchronization section of `sync-finalization.md` | Git/provider access |
| `finalization` | Mains match and the agentic PR is already verified closed-unmerged, so the run is ready for archive compaction. | finalization section of `sync-finalization.md` | Git/provider access |

## Tiny permission gate

For a tiny candidate, report the settled behavior, expected files or seam, why one product commit is credible, risk, and verification. Ask for explicit permission to use `tiny-change`. A general request to “use Slipway” is not tiny permission. If the user declines or does not answer, route to `small-development`.

## Bugs

Do not equate a reported symptom with a true bug. Route every bug claim through `bug-investigation` until `diagnosing-bugs` records reproduction and the first incorrect boundary. Then route a confirmed defect to `bug-fix`. Route requirement conflict or broader product behavior back through effort classification. Route environment/provider/evidence failures to an investigation result rather than product implementation.
