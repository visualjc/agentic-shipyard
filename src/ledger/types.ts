/** A pinned ledger tree read without checking the ledger out in a product worktree. */
export type LedgerSnapshot = Readonly<{ head: string | undefined; records: Readonly<Record<string, string>> }>;
export type LedgerInventoryEntry = Readonly<{ path:string; contents:string; ordinal:number }>;
export type LedgerInventory = Readonly<{ head:string; entries:readonly LedgerInventoryEntry[] }>;

export type LedgerWrite = Readonly<{ path: string; contents: string; /** Required current contents for a same-path replacement. */ expectedContents?: string | undefined }>;
export type LedgerTransaction = Readonly<{ expectedHead: string | undefined; writes: readonly LedgerWrite[]; message?: string }>;
export type LedgerCommitChange = Readonly<{ status: "added" | "modified" | "deleted"; path: string }>;
export type LedgerCommitInspection = Readonly<{
  commitSha: string;
  parentSha: string | undefined;
  changes: readonly LedgerCommitChange[];
}>;

/** Git's storage object format is an authority fact, not a property inferred from an ID. */
export type GitObjectFormat = "sha1" | "sha256";
export interface ObjectFormatAuthority {
  objectFormat(): Promise<GitObjectFormat>;
}

/** Durable isolated history port. Implementations compare expectedHead atomically. */
export interface LedgerStore {
  snapshot(paths: readonly string[]): Promise<LedgerSnapshot>;
  transact(transaction: LedgerTransaction): Promise<string>;
}

/** Current-head prefix inventory with ledger-ancestry ordinals, for authority-bound evidence discovery. */
export interface LedgerInventoryReader {
  currentInventory(prefix:string):Promise<LedgerInventory>;
}
