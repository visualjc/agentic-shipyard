export type SingleRepositoryFailureCode =
  | "invalid-state"
  | "authority-changed"
  | "evidence-stale"
  | "path-policy"
  | "git-observation-changed"
  | "provider-mismatch"
  | "checkpoint-conflict"
  | "human-merge-required"
  | "unsafe-recovery";

export class SingleRepositoryError extends Error {
  readonly name = "SingleRepositoryError";
  constructor(readonly code: SingleRepositoryFailureCode, message: string) { super(message); }
}
