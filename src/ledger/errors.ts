export type LedgerFailureCode = "ledger-stale-head" | "ledger-path-conflict" | "ledger-invalid-path" | "ledger-duplicate-path" | "ledger-invalid-record" | "ledger-unavailable";

export class LedgerError extends Error {
  readonly name = "LedgerError";
  constructor(readonly code: LedgerFailureCode, message: string) { super(message); }
}
