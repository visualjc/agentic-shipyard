import { randomUUID } from "node:crypto";
import { FilesystemAdapter } from "../adapters/filesystem.js";
import { ProcessAdapter } from "../adapters/process.js";

export interface MutationLockRecord {
  version: 1;
  repository: string;
  operation: string;
  processId: number;
  host: string;
  token: string;
  acquiredAt: string;
}
/**
 * A deliberately short-lived mutex for changing the primary lock file. It is
 * never recovered automatically: a crashed transition must be inspected rather
 * than letting a later process guess whether the prior transition finished.
 */
interface TransitionOwner {
  version: 1;
  host: string;
  processId: number;
  token: string;
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

/** Exclusive lock whose durable owner records always require manual recovery. */
export class MutationLockService {
  constructor(private readonly filesystem: FilesystemAdapter, private readonly process: ProcessAdapter, private readonly staleAfterMs = 10 * 60_000) {}

  async acquire(path: string, repository: string, operation: string): Promise<AcquiredMutationLock> {
    const record: MutationLockRecord = { version: 1, repository, operation, processId: this.process.processId(), host: this.process.hostName(), token: randomUUID(), acquiredAt: this.process.now().toISOString() };
    await this.withLifecycleGuard(path, async () => {
      if (!await this.filesystem.createTextExclusive(path, JSON.stringify(record))) {
        await this.recoverStaleWhileGuarded(path, repository);
        if (!await this.filesystem.createTextExclusive(path, JSON.stringify(record))) {
          throw new MutationLockError("lock-held", "A mutation lock is already held for this repository.");
        }
      }
    });
    let released = false;
    return { record, release: async () => {
      if (released) {
        throw new MutationLockError("lock-unsafe-recovery", "This acquired mutation lock was already released.");
      }
      await this.withLifecycleGuard(path, async () => {
        const current = await this.read(path);
        if (!sameIdentity(current, record)) {
          throw new MutationLockError("lock-unsafe-recovery", "Lock ownership changed; refusing to remove another owner’s lock.");
        }
        await this.filesystem.remove(path);
      }, true);
      released = true;
    }};
  }

  /**
   * Acquires an atomic sibling record for the short create/release/recovery
   * transition only. The primary lock remains held for the caller's long
   * operation, while this mutex is released immediately after its state change.
   *
   * Unlike the old directory-and-owner protocol, the transition has a single
   * object and no separate directory finalizer. A participant therefore cannot
   * observe the owner absent, remove a parent directory, and race a stale
   * finalizer against a replacement. An orphaned transition intentionally
   * blocks with manual-recovery guidance rather than being auto-reclaimed.
   */
  private async withTransition<T>(path: string, operation: () => Promise<T>, waitForLiveOwner = false): Promise<T> {
    const transitionPath = `${path}.transition`;
    let owner: TransitionOwner;
    for (;;) {
      owner = { version: 1, host: this.process.hostName(), processId: this.process.processId(), token: `${this.process.processId()}-${this.process.now().getTime()}-${Math.random().toString(16).slice(2)}`, acquiredAt: this.process.now().toISOString() };
      if (await this.filesystem.createTextExclusive(transitionPath, JSON.stringify(owner))) break;
      const blocked = await this.transitionBlocked(transitionPath);
      if (!waitForLiveOwner || blocked.code !== "lock-held") throw blocked;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    try { return await operation(); }
    finally {
      const current = await this.readTransitionOwner(transitionPath);
      if (!sameTransitionOwner(current, owner)) {
        throw new MutationLockError("lock-unsafe-recovery", "Transition ownership changed; refusing to remove another owner’s transition record.");
      }
      await this.filesystem.remove(transitionPath);
    }
  }

  private async transitionBlocked(path: string): Promise<MutationLockError> {
    const owner = await this.readTransitionOwner(path);
    if (!owner) return new MutationLockError("lock-held", "A mutation-lock transition is changing; retry the operation.");
    if (owner.host !== this.process.hostName()) return new MutationLockError("lock-unsafe-recovery", "A transition belongs to another host; manual recovery is required.");
    if (owner.processId === this.process.processId() || await this.process.isProcessAlive(owner.processId)) {
      return new MutationLockError("lock-held", "A mutation-lock transition is already in progress.");
    }
    return new MutationLockError("lock-unsafe-recovery", "A prior mutation-lock transition may have crashed; manual recovery is required.");
  }

  private async readTransitionOwner(path: string): Promise<TransitionOwner | undefined> {
    const text = await this.filesystem.readText(path);
    if (text === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object") throw new Error();
      const owner = value as Partial<TransitionOwner>;
      if (!hasExactKeys(value, ["version", "host", "processId", "token", "acquiredAt"]) || owner.version !== 1 || !nonEmptyString(owner.host) || !positiveInteger(owner.processId) || !nonEmptyString(owner.token) || !canonicalTimestamp(owner.acquiredAt)) throw new Error();
      return owner as TransitionOwner;
    } catch { throw new MutationLockError("lock-invalid", "Mutation-lock transition record is malformed; manual recovery is required."); }
  }

  /**
   * Retains an existing lifecycle owner record for manual recovery, but wraps
   * its entire creation/removal finalizer in the
   * transition mutex. The mutex is not held while the user's mutation runs.
   */
  private async withLifecycleGuard<T>(path: string, operation: () => Promise<T>, waitForLiveTransition = false): Promise<T> {
    return this.withTransition(path, async () => {
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
    }, waitForLiveTransition);
  }

  /** Called only while the non-recovering transition record is held. */
  private async recoverLifecycleGuard(guard: string, ownerPath: string): Promise<"retry" | MutationLockError> {
    const text = await this.filesystem.readText(ownerPath);
    if (text === undefined) {
      return await this.filesystem.removeEmptyDirectory(guard)
        ? "retry"
        : new MutationLockError("lock-held", "Lifecycle guard changed during recovery; retry the operation.");
    }
    const owner = this.parseLifecycleOwner(text);
    if (owner instanceof MutationLockError) return owner;
    if (owner.processId === this.process.processId() || (owner.host === this.process.hostName() && await this.process.isProcessAlive(owner.processId))) {
      return new MutationLockError("lock-held", "Mutation lock lifecycle is owned by a live process.");
    }
    return new MutationLockError("lock-unsafe-recovery", "Lifecycle guard ownership cannot be globally proven; manual recovery is required.");
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

  /** Called only while the lifecycle guard and transition record are held. Durable primary locks are never auto-removed. */
  private async recoverStaleWhileGuarded(path: string, repository: string): Promise<void> {
    const existing = await this.read(path);
    if (!existing) return;
    if (existing.repository !== repository) throw new MutationLockError("lock-invalid", "Lock repository identity does not match requested repository.");
    const acquired = Date.parse(existing.acquiredAt);
    if (!Number.isFinite(acquired)) throw new MutationLockError("lock-invalid", "Lock acquisition time is invalid.");
    if (this.process.now().getTime() - acquired <= this.staleAfterMs) throw new MutationLockError("lock-held", "A recent mutation lock is already held.");
    if (existing.processId === this.process.processId() || (existing.host === this.process.hostName() && await this.process.isProcessAlive(existing.processId))) {
      throw new MutationLockError("lock-held", "Stale-looking lock owner process is still alive.");
    }
    throw new MutationLockError("lock-unsafe-recovery", "Stale mutation lock ownership cannot be globally proven; manual recovery is required.");
  }

  private async read(path: string): Promise<MutationLockRecord | undefined> {
    const text = await this.filesystem.readText(path);
    if (text === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error();
      const record = parsed as Partial<MutationLockRecord>;
      if (!hasExactKeys(parsed, ["version", "repository", "operation", "processId", "host", "token", "acquiredAt"]) || record.version !== 1 || !nonEmptyString(record.repository) || !nonEmptyString(record.operation) || !positiveInteger(record.processId) || !nonEmptyString(record.host) || !nonEmptyString(record.token) || !canonicalTimestamp(record.acquiredAt)) throw new Error();
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
    left.host === right.host && left.processId === right.processId && left.token === right.token && left.acquiredAt === right.acquiredAt;
}

function sameLifecycleOwner(left: LifecycleOwner | undefined, right: LifecycleOwner): boolean {
  return left !== undefined && left.version === right.version && left.host === right.host &&
    left.processId === right.processId && left.token === right.token && left.acquiredAt === right.acquiredAt;
}

function sameTransitionOwner(left: TransitionOwner | undefined, right: TransitionOwner): boolean {
  return left !== undefined && left.version === right.version && left.host === right.host &&
    left.processId === right.processId && left.token === right.token && left.acquiredAt === right.acquiredAt;
}
