export type WorkspaceFailureCode =
  | "workspace-authoritative-main"
  | "workspace-conflict"
  | "workspace-registry-invalid"
  | "workspace-ledger-conflict"
  | "workspace-invalid-input"
  | "workspace-identity-mismatch"
  | "workspace-dirty";
export class WorkspaceError extends Error {
  readonly name = "WorkspaceError";
  constructor(readonly code: WorkspaceFailureCode, message: string) { super(message); }
}
