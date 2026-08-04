export type OrchestrationFailureCode = "invalid-classification" | "ambiguous-classification";

export class OrchestrationError extends Error {
  readonly name = "OrchestrationError";
  constructor(readonly code: OrchestrationFailureCode, message: string) { super(message); }
}
