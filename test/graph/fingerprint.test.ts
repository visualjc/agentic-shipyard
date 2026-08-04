import assert from "node:assert/strict";
import test from "node:test";
import { graphFingerprint, snapshotGraphSource, type GraphSourceReader } from "../../src/index.js";

test("snapshot is canonical and changes for staged, unstaged, deletion, rename and permitted untracked Git records", async () => {
  const reader: GraphSourceReader = { canonicalWorktree: async () => "/private/wt", worktreeInstanceId: async () => `git-worktree-v1:${"a".repeat(64)}`, headSha: async () => "A".repeat(40), worktreeStatus: async () => "1 M. N... 100755 100644 100755 abc def path\0? new\0u R. N... old\0new\0" };
  const snapshot = await snapshotGraphSource(reader, "/ignored");
  assert.equal(snapshot.headSha, "a".repeat(40));
  assert.equal(snapshot.workingTreeFingerprint, graphFingerprint("1 M. N... 100755 100644 100755 abc def path\0? new\0u R. N... old\0new\0"));
  assert.notEqual(graphFingerprint("clean"), graphFingerprint("dirty"));
});
