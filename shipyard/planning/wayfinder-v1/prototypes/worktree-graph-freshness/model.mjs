export const tools = ["graphify", "codegraph", "understand-anything"];

export function evaluateFreshness({
  available,
  descriptor,
  currentCommit,
  currentFingerprint,
  expectedToolSource,
  lock,
  staleLockAfterMs = 60_000,
  now = Date.now(),
}) {
  if (!available) {
    return { status: "fallback", authoritative: false, reason: "tool unavailable; inspect source directly" };
  }
  if (lock) {
    const ageMs = now - lock.createdAt;
    if (ageMs >= staleLockAfterMs) {
      return { status: "blocked", authoritative: false, reason: "stale cache lock requires verified recovery" };
    }
    return { status: "blocked", authoritative: false, reason: "cache refresh is in progress" };
  }
  if (!descriptor) {
    return { status: "stale", authoritative: false, reason: "no graph descriptor" };
  }
  if (descriptor.toolSource !== expectedToolSource) {
    return { status: "invalid", authoritative: false, reason: "graph was built by an unreviewed tool source" };
  }
  if (descriptor.indexedCommit !== currentCommit) {
    return { status: "stale", authoritative: false, reason: "indexed commit differs from worktree HEAD" };
  }
  if (descriptor.workingTreeFingerprint !== currentFingerprint) {
    return { status: "stale", authoritative: false, reason: "working-tree fingerprint differs" };
  }
  return { status: "fresh", authoritative: true, reason: "commit and working tree match" };
}

export function initialExplorerState() {
  return {
    toolIndex: 0,
    commitAdvanced: false,
    dirty: false,
    available: true,
    locked: false,
  };
}

export function reduceExplorer(state, action) {
  switch (action.type) {
    case "cycle-tool":
      return { ...state, toolIndex: (state.toolIndex + 1) % tools.length };
    case "toggle-commit":
      return { ...state, commitAdvanced: !state.commitAdvanced };
    case "toggle-dirty":
      return { ...state, dirty: !state.dirty };
    case "toggle-available":
      return { ...state, available: !state.available };
    case "toggle-lock":
      return { ...state, locked: !state.locked };
    case "refresh":
      return { ...state, commitAdvanced: false, dirty: false, locked: false };
    default:
      return state;
  }
}

export function deriveExplorerView(state) {
  const tool = tools[state.toolIndex];
  const source = `${tool}@reviewed-source`;
  const descriptor = {
    tool,
    toolSource: source,
    indexedCommit: "a".repeat(40),
    workingTreeFingerprint: "f".repeat(64),
    cacheRoot: `/cache/worktree/${tool}`,
  };
  const currentCommit = state.commitAdvanced ? "b".repeat(40) : descriptor.indexedCommit;
  const currentFingerprint = state.dirty ? "d".repeat(64) : descriptor.workingTreeFingerprint;
  const lock = state.locked ? { createdAt: Date.now() - 120_000 } : null;
  return {
    tool,
    descriptor,
    currentCommit,
    currentFingerprint,
    result: evaluateFreshness({
      available: state.available,
      descriptor,
      currentCommit,
      currentFingerprint,
      expectedToolSource: source,
      lock,
    }),
  };
}

