export type ContractErrorCode =
  | "invalid-document"
  | "unsupported-schema-version"
  | "invalid-profile"
  | "invalid-binding"
  | "invalid-path-policy"
  | "invalid-operation"
  | "invalid-lifecycle";

/** A stable, display-safe error emitted when an external document is invalid. */
export class ContractValidationError extends Error {
  readonly name = "ContractValidationError";

  constructor(
    readonly code: ContractErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${code}:${path}: ${message}`);
  }
}

export function invalid(code: ContractErrorCode, path: string, message: string): never {
  throw new ContractValidationError(code, path, message);
}
