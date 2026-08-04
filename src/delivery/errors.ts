export type DeliveryFailureCode =
  | "delivery-registry-missing"
  | "delivery-registry-invalid"
  | "delivery-duplicate"
  | "delivery-not-found"
  | "delivery-ambiguous"
  | "delivery-worktree-mismatch";

/** Structured delivery failures; the CLI layer alone is responsible for guidance. */
export class DeliveryError extends Error {
  readonly name = "DeliveryError";
  constructor(readonly code: DeliveryFailureCode, message: string) { super(message); }
}
