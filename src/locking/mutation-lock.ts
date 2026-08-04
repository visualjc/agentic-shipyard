import { FilesystemAdapter } from "../adapters/filesystem.js";
import { ProcessAdapter } from "../adapters/process.js";

export interface MutationLockRecord {
  version: 1;
  repository: string;
  operation: string;
  processId: number;
  host: string;
  acquiredAt: string;
}
export class MutationLockError extends Error {
  readonly name = "MutationLockError";
  constructor(readonly code: "lock-held" | "lock-invalid" | "lock-unsafe-recovery", message: string) { super(message); }
}
export interface AcquiredMutationLock { record: MutationLockRecord; release(): Promise<void>; }

/** Exclusive lock with deliberately conservative recovery: another host is never removed locally. */
export class MutationLockService {
  constructor(private readonly filesystem: FilesystemAdapter, private readonly process: ProcessAdapter, private readonly staleAfterMs = 10 * 60_000) {}

  async acquire(path: string, repository: string, operation: string): Promise<AcquiredMutationLock> {
    const record: MutationLockRecord = { version: 1, repository, operation, processId: this.process.processId(), host: this.process.hostName(), acquiredAt: this.process.now().toISOString() };
    const transition = await this.filesystem.withExclusiveDirectory(`${path}.lifecycle`, async () => {
      if (!await this.filesystem.createTextExclusive(path, JSON.stringify(record))) {
        await this.recoverStaleWhileGuarded(path, repository);
        if (!await this.filesystem.createTextExclusive(path, JSON.stringify(record))) {
          throw new MutationLockError("lock-held", "A mutation lock is already held for this repository.");
        }
      }
    });
    if (!transition.acquired) throw new MutationLockError("lock-held", "Mutation lock lifecycle is being changed by another process.");
    return { record, release: async () => {
      const release = await this.filesystem.withExclusiveDirectory(`${path}.lifecycle`, async () => {
        const current = await this.read(path);
        if (!sameIdentity(current, record)) {
          throw new MutationLockError("lock-unsafe-recovery", "Lock ownership changed; refusing to remove another owner’s lock.");
        }
        await this.filesystem.remove(path);
      });
      if (!release.acquired) throw new MutationLockError("lock-held", "Mutation lock lifecycle is being changed by another process.");
    }};
  }

  /** Called only while the lifecycle directory guard is held. */
  private async recoverStaleWhileGuarded(path: string, repository: string): Promise<void> {
    const existing = await this.read(path);
    if (!existing) return;
    if (existing.repository !== repository) throw new MutationLockError("lock-invalid", "Lock repository identity does not match requested repository.");
    const acquired = Date.parse(existing.acquiredAt);
    if (!Number.isFinite(acquired)) throw new MutationLockError("lock-invalid", "Lock acquisition time is invalid.");
    if (this.process.now().getTime() - acquired <= this.staleAfterMs) throw new MutationLockError("lock-held", "A recent mutation lock is already held.");
    if (existing.host !== this.process.hostName()) throw new MutationLockError("lock-unsafe-recovery", "Cannot validate a stale lock owned by another host.");
    if (await this.process.isProcessAlive(existing.processId)) throw new MutationLockError("lock-held", "Stale-looking lock owner process is still alive.");
    await this.filesystem.remove(path);
  }

  private async read(path: string): Promise<MutationLockRecord | undefined> {
    const text = await this.filesystem.readText(path);
    if (text === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error();
      const record = parsed as Partial<MutationLockRecord>;
      if (record.version !== 1 || typeof record.repository !== "string" || typeof record.operation !== "string" || typeof record.processId !== "number" || typeof record.host !== "string" || typeof record.acquiredAt !== "string") throw new Error();
      return record as MutationLockRecord;
    } catch { throw new MutationLockError("lock-invalid", "Mutation lock file is malformed."); }
  }
}

function sameIdentity(left: MutationLockRecord | undefined, right: MutationLockRecord): boolean {
  return left !== undefined && left.repository === right.repository && left.operation === right.operation &&
    left.host === right.host && left.processId === right.processId && left.acquiredAt === right.acquiredAt;
}
