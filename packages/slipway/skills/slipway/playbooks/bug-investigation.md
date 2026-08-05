# Bug investigation

1. Apply the [run start contract](../references/run-start.md). Use `triage` only when the input is a raw report the user did not create and it is not already agent-ready. Do not triage tickets from `to-tickets` or structured delivery-PR feedback.
2. Invoke `diagnosing-bugs`. Reproduce through the highest practical public seam and identify the first incorrect boundary before editing code.
3. Classify the evidence:
   - confirmed bounded implementation bug: route to [bug-fix.md](bug-fix.md);
   - requirement conflict: stop implementation and route to `grill-with-docs` or Wayfinder according to uncertainty;
   - broader product behavior: reclassify as small or large development;
   - environment, provider, or evidence failure: report the diagnosis and do not patch product code.
4. For a confirmed fix, promote only reviewed cargo and enter delivery follow-up.

Output reproduction evidence, classification, first incorrect boundary, exact fix SHA when applicable, and one next action.
