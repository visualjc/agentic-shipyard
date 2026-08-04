export type BindingFailureCode =
  | "repository-unbound"
  | "binding-store-invalid"
  | "binding-duplicate"
  | "binding-stale"
  | "binding-remote-mismatch"
  | "topology-incomplete"
  | "topology-invalid";

/** Internal structured failure; the command layer alone turns it into user guidance. */
export class BindingError extends Error {
  readonly name = "BindingError";
  constructor(readonly code: BindingFailureCode, message: string) {
    super(message);
  }
}
