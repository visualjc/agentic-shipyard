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
interface LifecycleOwner {
  version: 1;
  host: string;
  processId: number;
  token: string;
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
    await this.withLifecycleGuard(path, async () => {
      if (!await this.filesystem.createTextExclusive(path, JSON.stringify(record))) {
        await this.recoverStaleWhileGuarded(path, repository);
        if (!await this.filesystem.createTextExclusive(path, JSON.stringify(record))) {
          throw new MutationLockError("lock-held", "A mutation lock is already held for this repository.");
        }
      }
    });
    return { record, release: async () => {
      await this.withLifecycleGuard(path, async () => {
        const current = await this.read(path);
        if (!sameIdentity(current, record)) {
          throw new MutationLockError("lock-unsafe-recovery", "Lock ownership changed; refusing to remove another owner’s lock.");
        }
        await this.filesystem.remove(path);
      });
    }};
  }

  /**
   * A lifecycle directory is an intentionally durable lease, not a transient mutex.
   * Its owner file is written before a mutation transition and is removed only by the
   * owner.  A later process may reclaim it only after proving a same-host owner dead.
   */
  private async withLifecycleGuard<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const guard = `${path}.lifecycle`;
    const ownerPath = `${guard}/owner.json`;
    for (;;) {
      const owner: LifecycleOwner = { version: 1, host: this.process.hostName(), processId: this.process.processId(), token: `${this.process.processId()}-${this.process.now().getTime()}-${Math.random().toString(16).slice(2)}`, acquiredAt: this.process.now().toISOString() };
      const held = await this.filesystem.withExclusiveDirectory(guard, async () => {
        if (!await this.filesystem.createTextExclusive(ownerPath, JSON.stringify(owner))) {
          throw new MutationLockError("lock-unsafe-recovery", "Lifecycle guard was populated before its owner record could be established; manual recovery is required.");
        }
        try { return await operation(); }
        finally {
          const current = await this.readLifecycleOwner(ownerPath);
          if (!sameLifecycleOwner(current, owner)) {
            throw new MutationLockError("lock-unsafe-recovery", "Lifecycle guard ownership changed; refusing to remove another owner’s guard.");
          }
          await this.filesystem.remove(ownerPath);
        }
      });
      if (held.acquired) return held.value;

      const recovery = await this.recoverLifecycleGuard(guard, ownerPath);
      if (recovery === "retry") continue;
      throw recovery;
    }
  }

  private async recoverLifecycleGuard(guard: string, ownerPath: string): Promise<"retry" | MutationLockError> {
    // Serializing recovery *inside* the durable guard prevents two reclaimers
    // from deleting a just-published replacement owner record.
    const recovery = await this.filesystem.withExclusiveDirectory(`${guard}/recovery`, async () => {
      const text = await this.filesystem.readText(ownerPath);
      if (text === undefined) return "remove" as const;
      const owner = this.parseLifecycleOwner(text);
      if (owner instanceof MutationLockError) return owner;
      if (owner.host !== this.process.hostName()) return new MutationLockError("lock-unsafe-recovery", "Cannot validate a lifecycle guard owned by another host; manual recovery is required.");
      if (owner.processId === this.process.processId() || await this.process.isProcessAlive(owner.processId)) return new MutationLockError("lock-held", "Mutation lock lifecycle is owned by a live process.");
      await this.filesystem.remove(ownerPath);
      return "remove" as const;
    });
    if (!recovery.acquired) return new MutationLockError("lock-held", "Lifecycle guard is being initialized or recovered by another process.");
    if (recovery.value instanceof MutationLockError) return recovery.value;
    return await this.filesystem.removeEmptyDirectory(guard)
      ? "retry"
      : new MutationLockError("lock-held", "Lifecycle guard changed during recovery; retry the operation.");
  }

  private async readLifecycleOwner(path: string): Promise<LifecycleOwner | undefined> {
    const text = await this.filesystem.readText(path);
    return text === undefined ? undefined : this.parseLifecycleOwner(text) as LifecycleOwner;
  }

  private parseLifecycleOwner(text: string): LifecycleOwner | MutationLockError {
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object") throw new Error();
      const owner = value as Partial<LifecycleOwner>;
      if (!hasExactKeys(value, ["version", "host", "processId", "token", "acquiredAt"]) || owner.version !== 1 || !nonEmptyString(owner.host) || !positiveInteger(owner.processId) || !nonEmptyString(owner.token) || !canonicalTimestamp(owner.acquiredAt)) throw new Error();
      return owner as LifecycleOwner;
    } catch { return new MutationLockError("lock-invalid", "Lifecycle guard owner record is malformed; manual recovery is required."); }
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
      if (!hasExactKeys(parsed, ["version", "repository", "operation", "processId", "host", "acquiredAt"]) || record.version !== 1 || !nonEmptyString(record.repository) || !nonEmptyString(record.operation) || !positiveInteger(record.processId) || !nonEmptyString(record.host) || !canonicalTimestamp(record.acquiredAt)) throw new Error();
      return record as MutationLockRecord;
    } catch { throw new MutationLockError("lock-invalid", "Mutation lock file is malformed."); }
  }
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value > 0; }
function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function sameIdentity(left: MutationLockRecord | undefined, right: MutationLockRecord): boolean {
  return left !== undefined && left.repository === right.repository && left.operation === right.operation &&
    left.host === right.host && left.processId === right.processId && left.acquiredAt === right.acquiredAt;
}

function sameLifecycleOwner(left: LifecycleOwner | undefined, right: LifecycleOwner): boolean {
  return left !== undefined && left.version === right.version && left.host === right.host &&
    left.processId === right.processId && left.token === right.token && left.acquiredAt === right.acquiredAt;
}
