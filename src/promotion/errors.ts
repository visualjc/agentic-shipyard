export type PromotionFailureCode =
  | "invalid-state" | "authority-changed" | "evidence-stale" | "path-policy"
  | "git-observation-changed" | "unsafe-payload" | "provider-mismatch"
  | "checkpoint-conflict" | "human-merge-required" | "unsafe-recovery";

export class PromotionError extends Error {
  readonly name = "PromotionError";
  constructor(readonly code: PromotionFailureCode, message: string) { super(message); }
}
