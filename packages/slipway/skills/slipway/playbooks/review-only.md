# Review-only

1. Resolve the requested base and head to exact SHAs. Refuse a moving or ambiguous target.
2. Invoke a fresh independent `code-review` with intent, canonical spec, diff range, repository standards, verification commands, forbidden mutations, and exact head.
3. Record findings, commands actually run, limitations, and verdict in an immutable event tied to the exact SHA.
4. Do not edit code, post comments, approve, dismiss, or mutate provider state unless the user separately authorizes follow-up.

Output the exact reviewed SHA, standards verdict, spec verdict, findings, verification, limitations, and one next action.
