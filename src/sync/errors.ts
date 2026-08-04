export type SyncErrorCode = "dirty-worktree" | "wrong-branch" | "baseline-diverged" | "remote-identity" | "unsafe-source-ref" | "invalid-object-id" | "path-policy" | "observation-changed" | "source-stale";
export class SyncError extends Error {
  readonly name = "SyncError";
  constructor(readonly code: SyncErrorCode, message: string) { super(message); }
}
