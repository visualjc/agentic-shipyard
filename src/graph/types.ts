/** Experimental graph data is an acceleration only, never delivery authority. */
export const GRAPH_FINGERPRINT_VERSION = "git-v1";
export const GRAPH_FALLBACK_ACTION = "inspect-source-directly" as const;
export const GRAPH_STATES = ["disabled", "fresh", "stale", "unavailable", "invalid", "blocked", "failed"] as const;
export type GraphState = typeof GRAPH_STATES[number];

export type GraphSource = Readonly<{ worktreeRoot: string; worktreeInstanceId: string; headSha: string; workingTreeFingerprint: string }>;
export type GraphDescriptor = Readonly<{
  adapter: "graphify" | "codegraph";
  reviewedToolSource: string;
  cacheIdentity: string;
  cacheRoot: string;
  worktreeRoot: string;
  worktreeInstanceId: string;
  indexedCommit: string;
  /** Immutable authoritative-main seed, when this private cache was seeded. */
  seededFromSha?: string;
  workingTreeFingerprint: string;
  refreshedAt: string;
}>;
export type GraphDecision = Readonly<{
  state: GraphState;
  authoritative: boolean;
  fallbackAction: typeof GRAPH_FALLBACK_ACTION;
  reason: string;
}>;
export type GraphCacheLock = Readonly<{ ownerHost: string; ownerPid: number; acquiredAt: string; token?: string }>;
export type GraphRuntime = Readonly<{ available: boolean; reason?: string }>;
export type GraphResult = Readonly<{ decision: GraphDecision; descriptor?: GraphDescriptor }>;
/** Baseline is deliberately distinct from a feature worktree and must be proved by its Git authority port. */
/**
 * A seed is accepted only from the independently resolved authoritative main
 * checkout.  These fields are produced by the Git authority boundary, not by
 * a feature-worktree caller labelling an arbitrary descriptor as "main".
 */
export type GraphBaseline = Readonly<{
  source: GraphSource;
  descriptor: GraphDescriptor;
  authoritativeRef: "refs/heads/main";
  resolvedSha: string;
  objectFormat: "sha1" | "sha256";
  clean: true;
}>;
