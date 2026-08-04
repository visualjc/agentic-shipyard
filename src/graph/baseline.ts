import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "../adapters/git-transport.js";
import { snapshotGraphSource, createGitGraphSourceReader } from "./fingerprint.js";
import { graphDecision, validateGraphDescriptor } from "./freshness.js";
import type { GraphBaseline, GraphDecision, GraphDescriptor, GraphSource } from "./types.js";
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
  mainWorktree: string;
  featureWorktree: string;
  descriptor: GraphDescriptor;
  adapter: GraphDescriptor["adapter"];
  reviewedToolSource: string;
}>;

/**
 * Resolves baseline authority from live Git observations. Caller-labelled
 * `clean`, `main`, object-format, and SHA fields are never accepted.
 */
export async function authorizeGitGraphBaseline(request: GitGraphBaselineRequest, gitExecutable = DEFAULT_NODE_GIT_EXECUTABLE): Promise<{ decision: GraphDecision; authorization?: GraphSeedAuthorization }> {
  try {
    const fields = Object.getOwnPropertyDescriptors(request); if (Object.values(fields).some(field => !("value" in field))) throw new Error(); const input = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])) as Record<string, unknown>;
    if (Object.keys(input).sort().join(",") !== "adapter,descriptor,featureWorktree,mainWorktree,reviewedToolSource" || typeof input.mainWorktree !== "string" || typeof input.featureWorktree !== "string" || (input.adapter !== "graphify" && input.adapter !== "codegraph") || typeof input.reviewedToolSource !== "string") throw new Error();
    const requestedDescriptor = snapshotDescriptor(input.descriptor);
    const executable = canonicalGitExecutable(gitExecutable);
    const reader = createGitGraphSourceReader(executable);
    const [main, featureSource] = await Promise.all([snapshotGraphSource(reader, input.mainWorktree), snapshotGraphSource(reader, input.featureWorktree)]);
    const [branch, resolvedSha, objectFormat, status] = await Promise.all([
      git(executable, main.worktreeRoot, ["symbolic-ref", "--quiet", "HEAD"]),
      git(executable, main.worktreeRoot, ["rev-parse", "--verify", "refs/heads/main"]),
      git(executable, main.worktreeRoot, ["rev-parse", "--show-object-format"]),
      git(executable, main.worktreeRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]),
    ]);
    if (branch !== "refs/heads/main" || resolvedSha !== main.headSha || status !== "" || (objectFormat !== "sha1" && objectFormat !== "sha256")) return { decision: graphDecision("invalid", "Authoritative main Git baseline is unavailable or dirty.") };
    if (main.worktreeRoot === featureSource.worktreeRoot || main.worktreeInstanceId === featureSource.worktreeInstanceId || main.headSha !== featureSource.headSha || main.workingTreeFingerprint !== featureSource.workingTreeFingerprint) return { decision: graphDecision("stale", "Authoritative main baseline does not exactly match the distinct feature source.") };
    const descriptorDecision = validateGraphDescriptor(main, requestedDescriptor, input.adapter, input.reviewedToolSource);
    if (!descriptorDecision.authoritative) return { decision: descriptorDecision };
    const [mainAfter, featureAfter] = await Promise.all([snapshotGraphSource(reader, main.worktreeRoot), snapshotGraphSource(reader, featureSource.worktreeRoot)]);
    if (!sameSource(mainAfter, main) || !sameSource(featureAfter, featureSource)) return { decision: graphDecision("stale", "Graph source changed while baseline authority was resolved.") };
    const baseline: GraphBaseline = Object.freeze({ source: main, descriptor: requestedDescriptor, authoritativeRef: "refs/heads/main", resolvedSha, objectFormat, clean: true });
    return { decision: graphDecision("fresh", "Live Git authority sealed an exact clean main baseline."), authorization: issue(baseline, featureSource) };
  } catch { return { decision: graphDecision("unavailable", "Authoritative main Git baseline could not be resolved safely.") }; }
}

function sameSource(left: GraphSource, right: GraphSource): boolean { return left.worktreeRoot === right.worktreeRoot && left.worktreeInstanceId === right.worktreeInstanceId && left.headSha === right.headSha && left.workingTreeFingerprint === right.workingTreeFingerprint; }

async function git(executable: string, cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(executable, ["-C", cwd, ...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 256 * 1024, env: sanitizedGitEnvironment({ GIT_TERMINAL_PROMPT: "0" }) });
  return result.stdout.replace(/\n$/, "");
}
