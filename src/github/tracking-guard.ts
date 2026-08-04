import { join } from "node:path";
import type { BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import { MutationLockService } from "../locking/mutation-lock.js";

/** Concrete durable guard: one common-directory/delivery key across processes. */
export class DevelopmentRecordGuard {
  constructor(private readonly locks: MutationLockService, private readonly bound: BoundProfileAuthorityResolver) {}

  async run<T>(repositoryPath: string, deliveryId: string, operation: () => Promise<T>): Promise<T> {
    const initial = await this.bound.resolve(repositoryPath, "review");
    const lock = await this.locks.acquire(join(initial.commonDirectory, `shipyard-development-record-${deliveryId}.lock`), initial.commonDirectory, `development-record:${deliveryId}`);
    try {
      await this.bound.resolve(repositoryPath, "review");
      return await operation();
    } finally { await lock.release(); }
  }
}
