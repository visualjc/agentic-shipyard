import { stableDeliveryId } from "../delivery/registry.js";

/** A durable, exact-match marker for one Shipyard development record pair. */
export function stableShipyardMarker(deliveryId: string): string {
  try { return `<!-- shipyard:development-record:v1:${stableDeliveryId(deliveryId)} -->`; }
  catch { throw new GitHubTrackerError("invalid-delivery-id", "A delivery ID must be a stable, safe identifier."); }
}

export type GitHubTrackerErrorCode =
  | "invalid-request"
  | "invalid-delivery-id"
  | "invalid-head-sha"
  | "noncanonical-ref"
  | "authority-mismatch"
  | "invalid-record"
  | "ambiguous-record"
  | "resume-mismatch"
  | "head-sha-mismatch"
  | "head-ref-mismatch"
  | "base-ref-mismatch"
  | "pagination-limit"
  | "write-unconfirmed";

/** A fail-closed error for unsafe-to-repeat tracker states. */
export class GitHubTrackerError extends Error {
  readonly name = "GitHubTrackerError";
  constructor(readonly code: GitHubTrackerErrorCode, message: string) { super(message); }
}
