import type { StatusContributor, SyncFreshness } from "../status/projection.js";
import type { Profile } from "../contracts/types.js";
import type { SourceProvenance } from "./types.js";

export type SyncStatus = Readonly<{ baseline: SyncFreshness; destinationSha?: string; source?: Readonly<{ provenance: SourceProvenance; fresh: boolean }>; blocker?: Readonly<{ code: string; message: string; nextSafeAction: string }>; nextSafeAction?: string }>;
export type SyncStatusReadRequest = Readonly<{ repositoryPath: string; destinationRemote: string; developmentBranch: string; destinationBranch: string; expectedRemoteUrl: string; profile: Profile }>;
export interface SyncStatusReader { read(request: SyncStatusReadRequest): Promise<SyncStatus>; }

/** Pure projection contribution: callers provide local facts; this function performs no I/O. */
export function syncStatusContributor(status: SyncStatus): StatusContributor {
  return projection => ({
    syncFreshness: status.baseline === "fresh" && (status.source?.fresh ?? true) ? "fresh" : status.baseline === "unavailable" ? "unavailable" : "stale",
    ...(status.destinationSha ? { destinationSha: status.destinationSha } : {}),
    providerRefs: { ...projection.providerRefs, sourceProvenance: status.source ? status.source.fresh ? "fresh" : "stale" : "none", ...(status.source ? { sourceRef: status.source.provenance.requestedRef, sourceSha: status.source.provenance.sha } : {}) },
    blockers: status.blocker ? [{ code: status.blocker.code, message: status.blocker.message }] : [],
    ...((status.blocker?.nextSafeAction ?? status.nextSafeAction) ? { nextSafeAction: status.blocker?.nextSafeAction ?? status.nextSafeAction! } : {}),
  });
}
