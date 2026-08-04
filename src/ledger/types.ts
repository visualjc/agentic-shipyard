/** A pinned ledger tree read without checking the ledger out in a product worktree. */
export type LedgerSnapshot = Readonly<{ head: string | undefined; records: Readonly<Record<string, string>> }>;

export type LedgerWrite = Readonly<{ path: string; contents: string; /** Required current contents for a same-path replacement. */ expectedContents?: string | undefined }>;
export type LedgerTransaction = Readonly<{ expectedHead: string | undefined; writes: readonly LedgerWrite[]; message?: string }>;

/** Durable isolated history port. Implementations compare expectedHead atomically. */
export interface LedgerStore {
  snapshot(paths: readonly string[]): Promise<LedgerSnapshot>;
  transact(transaction: LedgerTransaction): Promise<string>;
}
