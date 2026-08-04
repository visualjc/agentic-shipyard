import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createNodeGraphFiles, createNodeLocalGraphCommand, graphDescriptorPath, hasKnownProductGraphifyLeak, NodeGraphLockStore, readGraphDescriptorText } from "../adapters/graph-runtime.js";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "../adapters/git-transport.js";
import { nodeProcess } from "../adapters/process.js";
import type { Profile } from "../contracts/types.js";
import { validateProfile } from "../contracts/validate.js";
import { observeGraphArtifact } from "./artifact.js";
import { snapshotGraphSource, createGitGraphSourceReader } from "./fingerprint.js";
import { graphDecision, graphLockPath, graphOperationLockIdentity, validateGraphDescriptor } from "./freshness.js";
import { GraphLockService } from "./lock.js";
import type { GraphBaseline, GraphDecision, GraphSource } from "./types.js";
import { validateGraphDescriptor as snapshotDescriptor } from "./validation.js";

const execFileAsync = promisify(execFile);
type SeedAuthority = Readonly<{ baseline: GraphBaseline; featureSource: GraphSource }>;
const authorizations = new WeakMap<object, SeedAuthority>();
let issueAuthorization: (authority: SeedAuthority) => GraphSeedAuthorization;

/** Opaque runtime authority. A structurally identical caller object is rejected. */
export class GraphSeedAuthorization {
  private constructor() { Object.freeze(this); }
  static { issueAuthorization = (authority) => { const value = new GraphSeedAuthorization(); authorizations.set(value, authority); return value; }; }
}
function issue(baseline: GraphBaseline, featureSource: GraphSource): GraphSeedAuthorization { return issueAuthorization(Object.freeze({ baseline, featureSource })); }

export function consumeGraphSeedAuthorization(value: unknown): Readonly<{ baseline: GraphBaseline; featureSource: GraphSource }> | undefined {
  if (!(value instanceof GraphSeedAuthorization)) return undefined;
  const authority = authorizations.get(value); if (!authority) return undefined;
  authorizations.delete(value);
  return authority;
}

export type GitGraphBaselineRequest = Readonly<{
  home: string;
  profile: Profile;
  mainWorktree: string;
  featureWorktree: string;
}>;

/**
 * Resolves baseline authority from live Git and Shipyard-owned durable state.
 * No caller-supplied descriptor, cache path, or baseline field is accepted.
 */
export async function authorizeGitGraphBaseline(request: GitGraphBaselineRequest, gitExecutable = DEFAULT_NODE_GIT_EXECUTABLE): Promise<{ decision: GraphDecision; authorization?: GraphSeedAuthorization }> {
  try {
    const fields = Object.getOwnPropertyDescriptors(request); if (Object.values(fields).some(field => !("value" in field))) throw new Error(); const input = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])) as Record<string, unknown>;
    if (Object.keys(input).sort().join(",") !== "featureWorktree,home,mainWorktree,profile" || typeof input.home !== "string" || !isAbsolute(input.home) || resolve(input.home) !== input.home || typeof input.mainWorktree !== "string" || typeof input.featureWorktree !== "string") throw new Error();
    const profile = validateProfile(input.profile); if (!profile.graph?.enabled) return { decision: graphDecision("disabled", "Experimental graph acceleration is disabled.") };
    const executable = canonicalGitExecutable(gitExecutable);
    const reader = createGitGraphSourceReader(executable);
    const [main, featureSource] = await Promise.all([snapshotGraphSource(reader, input.mainWorktree), snapshotGraphSource(reader, input.featureWorktree)]);
    if (main.worktreeRoot === featureSource.worktreeRoot || main.worktreeInstanceId === featureSource.worktreeInstanceId || main.headSha !== featureSource.headSha || main.workingTreeFingerprint !== featureSource.workingTreeFingerprint) return { decision: graphDecision("stale", "Authoritative main baseline does not exactly match the distinct feature source.") };
    const stateRoot = profile.graph.adapter === "graphify" ? join(profile.graph.cacheRoot, ".shipyard-graph-state") : join(resolve(main.worktreeRoot), "..", ".shipyard-graph-state");
    const lock = new GraphLockService(new NodeGraphLockStore(), nodeProcess); const lockPath = graphLockPath(stateRoot, graphOperationLockIdentity(profile.graph.adapter, profile.graph.reviewedToolSource, main)); const acquired = await lock.acquire(lockPath);
    if (!acquired.lock) return { decision: acquired.decision ?? graphDecision("blocked", "Authoritative baseline cache lock could not be acquired.") };
    let decision: GraphDecision | undefined, baseline: GraphBaseline | undefined;
    try {
    const [branch, resolvedSha, objectFormat, status] = await Promise.all([
      git(executable, main.worktreeRoot, ["symbolic-ref", "--quiet", "HEAD"]),
      git(executable, main.worktreeRoot, ["rev-parse", "--verify", "refs/heads/main"]),
      git(executable, main.worktreeRoot, ["rev-parse", "--show-object-format"]),
      git(executable, main.worktreeRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]),
    ]);
    if (branch !== "refs/heads/main" || resolvedSha !== main.headSha || status !== "" || (objectFormat !== "sha1" && objectFormat !== "sha256")) decision = graphDecision("invalid", "Authoritative main Git baseline is unavailable or dirty.");
    const descriptorText = decision ? undefined : await readGraphDescriptorText(graphDescriptorPath(input.home, profile.graph.adapter, main.worktreeInstanceId));
    if (!decision && descriptorText === undefined) decision = graphDecision("stale", "No Shipyard-owned main graph descriptor exists.");
    const descriptor = decision ? undefined : snapshotDescriptor(JSON.parse(descriptorText!));
    if (!decision && descriptor) {
      const checked = validateGraphDescriptor(main, descriptor, profile.graph.adapter, profile.graph.reviewedToolSource, profile.graph.artifactSha256, profile.graph.adapter === "codegraph" ? profile.graph.nodeArtifactSha256 : undefined);
      if (!checked.authoritative) decision = checked;
    }
    const files = createNodeGraphFiles(executable), command = createNodeLocalGraphCommand();
    if (!decision && descriptor && profile.graph.adapter === "graphify") {
      const expectedCache = join(profile.graph.cacheRoot, createHash("sha256").update(main.worktreeInstanceId).digest("hex")); const cache = await files.canonicalPath(descriptor.cacheRoot); const observation = await observeGraphArtifact(command, profile.graph.executablePath, profile.graph.reviewedToolSource, profile.graph.artifactSha256);
      if (descriptor.cacheRoot !== expectedCache || cache !== expectedCache || !observation || !await files.exists(join(cache, "graphify-out")) || await hasKnownProductGraphifyLeak(main.worktreeRoot) || await files.contentDigest(join(cache, "graphify-out")) !== descriptor.contentSha256) decision = graphDecision("invalid", "Shipyard-owned Graphify baseline cache failed artifact/content verification.");
    }
    if (!decision && descriptor && profile.graph.adapter === "codegraph") {
      const cache = await files.canonicalPath(descriptor.cacheRoot), tool = await observeGraphArtifact(command, profile.graph.executablePath, profile.graph.reviewedToolSource, profile.graph.artifactSha256), runtime = await observeGraphArtifact(command, profile.graph.nodeExecutablePath, "node:sqlite-fts5", profile.graph.nodeArtifactSha256);
      if (cache !== join(main.worktreeRoot, ".codegraph") || !tool || !runtime || !await files.exists(cache) || !await files.excluded(main.worktreeRoot, ".codegraph/") || await files.tracked(cache) || await files.contentDigest(cache) !== descriptor.contentSha256) decision = graphDecision("invalid", "Shipyard-owned CodeGraph baseline cache failed artifact/content verification.");
    }
    const [mainAfter, featureAfter] = await Promise.all([snapshotGraphSource(reader, main.worktreeRoot), snapshotGraphSource(reader, featureSource.worktreeRoot)]);
    if (!decision && (!sameSource(mainAfter, main) || !sameSource(featureAfter, featureSource))) decision = graphDecision("stale", "Graph source changed while baseline authority was resolved.");
    if (!decision && descriptor) baseline = Object.freeze({ source: main, descriptor, authoritativeRef: "refs/heads/main", resolvedSha, objectFormat: objectFormat as "sha1" | "sha256", clean: true });
    } catch { decision = graphDecision("unavailable", "Authoritative main cache verification failed safely."); }
    try { await lock.release(lockPath, acquired.lock); } catch { return { decision: graphDecision("failed", "Authoritative baseline cache lock release could not be verified.") }; }
    if (decision || !baseline) return { decision: decision ?? graphDecision("unavailable", "Authoritative main baseline could not be established.") };
    return { decision: graphDecision("fresh", "Live Git and Shipyard-owned cache authority sealed an exact clean main baseline."), authorization: issue(baseline, featureSource) };
  } catch { return { decision: graphDecision("unavailable", "Authoritative main Git baseline could not be resolved safely.") }; }
}

function sameSource(left: GraphSource, right: GraphSource): boolean { return left.worktreeRoot === right.worktreeRoot && left.worktreeInstanceId === right.worktreeInstanceId && left.headSha === right.headSha && left.workingTreeFingerprint === right.workingTreeFingerprint; }

async function git(executable: string, cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(executable, ["-C", cwd, ...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 256 * 1024, env: sanitizedGitEnvironment({ GIT_TERMINAL_PROMPT: "0" }) });
  return result.stdout.replace(/\n$/, "");
}
