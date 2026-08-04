import assert from "node:assert/strict";
import test from "node:test";
import { DevelopmentRecordGuard } from "../../src/github/tracking-guard.js";
import { MutationLockService } from "../../src/locking/mutation-lock.js";
import { FakeProcess, MemoryFilesystem } from "../helpers/fakes.js";

test("rejects traversal delivery IDs before creating any guard filesystem state", async () => {
  const fs = new MemoryFilesystem();
  const guard = new DevelopmentRecordGuard(new MutationLockService(fs, new FakeProcess()), { resolve: async () => ({ profileName: "p", commonDirectory: "/repo/.git", profileFingerprint: "0".repeat(64), actorLogin: "actor", topology: { kind: "single-repository", repository: { owner: "acme", name: "repo", remote: { name: "origin", url: "https://example.test/repo.git" }, defaultBranch: "main" } } }) });
  await assert.rejects(guard.run("/repo", "../../escape", async () => undefined));
  assert.equal(fs.files.size, 0); assert.equal(fs.directories.size, 0);
});
