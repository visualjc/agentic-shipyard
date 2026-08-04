export type ContextFailureCode =
  | "context-invalid-envelope"
  | "context-repository-mismatch"
  | "context-records-not-allowed"
  | "context-stale-product"
  | "context-ledger-record-missing";

export class ContextError extends Error {
  readonly name = "ContextError";
  constructor(readonly code: ContextFailureCode, message: string) { super(message); }
}
