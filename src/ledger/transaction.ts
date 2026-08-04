import { LedgerError } from "./errors.js";
import type { LedgerSnapshot, LedgerTransaction } from "./types.js";

/** Validates a compare-and-swap ledger edit and returns its prospective tree. */
export function applyLedgerTransaction(snapshot: LedgerSnapshot, transaction: LedgerTransaction): Record<string, string> {
  if (snapshot.head !== transaction.expectedHead) throw new LedgerError("ledger-stale-head", "The ledger advanced; re-read its head before retrying.");
  const records = { ...snapshot.records };
  const paths = new Set<string>();
  for (const write of transaction.writes) {
    if (!validPath(write.path)) throw new LedgerError("ledger-invalid-path", "Ledger record paths must be relative, normalized paths.");
    if (paths.has(write.path)) throw new LedgerError("ledger-duplicate-path", "A ledger transaction may write each record path only once.");
    paths.add(write.path);
    if (Object.hasOwn(records, write.path) && write.expectedContents === undefined) throw new LedgerError("ledger-path-conflict", "Overwriting a ledger record requires its expected contents.");
    if (write.expectedContents !== undefined && records[write.path] !== write.expectedContents) throw new LedgerError("ledger-path-conflict", "The ledger record changed; re-read it before retrying.");
    records[write.path] = write.contents;
  }
  return records;
}

export function validLedgerPath(path: string): boolean { return validPath(path); }
function validPath(path: string): boolean { return path.length > 0 && !path.startsWith("/") && !path.split("/").some((part) => part === "" || part === "." || part === ".."); }
