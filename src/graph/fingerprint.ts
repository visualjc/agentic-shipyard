import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
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

export function graphFingerprint(status: string): string {
  return `${GRAPH_FINGERPRINT_VERSION}:${createHash("sha256").update(status, "utf8").digest("hex")}`;
}

export async function snapshotGraphSource(reader: GraphSourceReader, worktreePath: string): Promise<GraphSource> {
  const root = await reader.canonicalWorktree(worktreePath);
  if (!root || !isAbsolute(root)) throw new GraphError("source-unavailable", "Canonical graph worktree root is unavailable.");
  const [headSha, worktreeInstanceId] = await Promise.all([reader.headSha(root), reader.worktreeInstanceId(root)]);
  const status = await reader.worktreeStatus(root);
  if (!headSha || !worktreeInstanceId || status === undefined) throw new GraphError("source-unavailable", "Exact Git source snapshot is unavailable or ambiguous.");
  return validateGraphSource({ worktreeRoot: resolve(root), worktreeInstanceId, headSha, workingTreeFingerprint: graphFingerprint(status) });
}
