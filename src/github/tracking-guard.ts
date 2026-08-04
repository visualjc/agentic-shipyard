import { join } from "node:path";
import type { BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import type { BoundProfileAuthority } from "../profile/bound-authority.js";
import { sameTopology } from "../profile/policy.js";
import { MutationLockService } from "../locking/mutation-lock.js";
import { stableDeliveryId } from "../delivery/registry.js";
import { GitHubTrackerError } from "./markers.js";

/** Coordinates the shared workspace lifecycle lock and a narrower delivery lock across processes. */
export class DevelopmentRecordGuard {
  constructor(private readonly locks: MutationLockService, private readonly bound: BoundProfileAuthorityResolver) {}

  async run<T>(repositoryPath: string, deliveryId: string, operation: () => Promise<T>): Promise<T> {
    const safeDeliveryId = stableDeliveryId(deliveryId);
    const initial = await this.bound.resolve(repositoryPath, "review");
    // Every tracker flow takes the workspace lock before its narrower delivery
    // lock. Workspace lifecycle operations take only the first lock, so this
    // fixed order prevents cleanup from removing its authority mid-provider flow.
    const workspaceLock = await this.locks.acquire(join(initial.commonDirectory, "shipyard-workspace.lock"), initial.commonDirectory, "development-record-workspace");
    try {
      const deliveryLock = await this.locks.acquire(join(initial.commonDirectory, `shipyard-development-record-${safeDeliveryId}.lock`), initial.commonDirectory, `development-record:${safeDeliveryId}`);
      try {
        const current = await this.bound.resolve(repositoryPath, "review");
        if (!sameAuthority(initial, current)) {
          throw new GitHubTrackerError("authority-mismatch", "Bound profile authority changed while waiting for the development-record lock.");
        }
        return await operation();
      } finally {
        await deliveryLock.release();
      }
    } finally { await workspaceLock.release(); }
  }
}

function sameAuthority(left: BoundProfileAuthority, right: BoundProfileAuthority): boolean {
  return left.profileName === right.profileName
    && left.commonDirectory === right.commonDirectory
    && left.profileFingerprint === right.profileFingerprint
    && left.actorLogin === right.actorLogin
    && sameTopology(left.topology, right.topology);
}
