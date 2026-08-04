import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "../adapters/git-transport.js";
import { GRAPH_FINGERPRINT_VERSION, type GraphSource } from "./types.js";
import { GraphError } from "./errors.js";
import { validateGraphSource } from "./validation.js";

/** Git-native observations: HEAD plus porcelain-v2 -z and permitted untracked paths. */
export interface GraphSourceReader {
  canonicalWorktree(path: string): Promise<string | undefined>;
  /** Durable/physical Git worktree proof; it must change when a path is recreated. */
  worktreeInstanceId(path: string): Promise<string | undefined>;
  headSha(path: string): Promise<string | undefined>;
  /** Must include staged/unstaged tracked changes (mode, symlink, rename, submodule and deletion). */
  worktreeStatus(path: string): Promise<string | undefined>;
}
const execFileAsync = promisify(execFile);

/**
 * Production Git reader.  The worktree identity is the physical, Git-created
 * per-worktree administration directory plus its creation metadata, rather
 * than a branch name or common-directory identity.  Recreating the same path
 * creates a new administration directory identity.
 */
export function createGitGraphSourceReader(gitExecutable = DEFAULT_NODE_GIT_EXECUTABLE): GraphSourceReader {
  const trustedGit = canonicalGitExecutable(gitExecutable);
  async function git(path: string, args: string[]): Promise<string | undefined> {
    try { const result = await execFileAsync(trustedGit, ["-C", path, ...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 256 * 1024, env: sanitizedGitEnvironment({ GIT_TERMINAL_PROMPT: "0" }) }); return result.stdout; } catch { return undefined; }
  }
  return {
    async canonicalWorktree(path) { try { return await realpath(path); } catch { return undefined; } },
    async worktreeInstanceId(path) { try { const dir = await git(path, ["rev-parse", "--git-dir"]); if (!dir) return undefined; const admin = await realpath(resolve(path, dir.trim())); const info = await stat(admin); return `git-worktree-v1:${createHash("sha256").update(JSON.stringify([admin, info.dev, info.ino, info.birthtimeMs])).digest("hex")}`; } catch { return undefined; } },
    async headSha(path) { return (await git(path, ["rev-parse", "--verify", "HEAD"]))?.trim(); },
    async worktreeStatus(path) { return git(path, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]); },
  };
}

export function graphFingerprint(status: string): string {
  return `${GRAPH_FINGERPRINT_VERSION}:${createHash("sha256").update(status, "utf8").digest("hex")}`;
}

export async function snapshotGraphSource(reader: GraphSourceReader, worktreePath: string): Promise<GraphSource> {
  let ports: Record<string, unknown>;
  try { if (!reader || typeof reader !== "object" || Object.getPrototypeOf(reader) !== Object.prototype) throw new Error(); const descriptors = Object.getOwnPropertyDescriptors(reader); if (Object.values(descriptors).some(field => !("value" in field))) throw new Error(); ports = Object.fromEntries(Object.entries(descriptors).map(([key, field]) => [key, field.value])); if (typeof ports.canonicalWorktree !== "function" || typeof ports.worktreeInstanceId !== "function" || typeof ports.headSha !== "function" || typeof ports.worktreeStatus !== "function") throw new Error(); }
  catch { throw new GraphError("source-unavailable", "Graph source reader is invalid."); }
  const root = await (ports.canonicalWorktree as GraphSourceReader["canonicalWorktree"])(worktreePath);
  if (!root || !isAbsolute(root)) throw new GraphError("source-unavailable", "Canonical graph worktree root is unavailable.");
  const [headSha, worktreeInstanceId] = await Promise.all([(ports.headSha as GraphSourceReader["headSha"])(root), (ports.worktreeInstanceId as GraphSourceReader["worktreeInstanceId"])(root)]);
  const status = await (ports.worktreeStatus as GraphSourceReader["worktreeStatus"])(root);
  if (!headSha || !worktreeInstanceId || status === undefined) throw new GraphError("source-unavailable", "Exact Git source snapshot is unavailable or ambiguous.");
  return validateGraphSource({ worktreeRoot: resolve(root), worktreeInstanceId, headSha, workingTreeFingerprint: graphFingerprint(status) });
}
