/** A durable, exact-match marker for one Shipyard development record pair. */
export function stableShipyardMarker(deliveryId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(deliveryId)) {
    throw new GitHubTrackerError("invalid-delivery-id", "A delivery ID must be a stable, safe identifier.");
  }
  return `<!-- shipyard:development-record:v1:${deliveryId} -->`;
}

export type GitHubTrackerErrorCode =
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
