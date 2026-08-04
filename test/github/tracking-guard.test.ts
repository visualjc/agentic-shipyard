import assert from "node:assert/strict";
import test from "node:test";
import { DevelopmentRecordGuard } from "../../src/github/tracking-guard.js";
import { GitHubTrackerError } from "../../src/github/markers.js";
import { MutationLockService } from "../../src/locking/mutation-lock.js";
import { FakeProcess, MemoryFilesystem } from "../helpers/fakes.js";

const topology = { kind: "single-repository" as const, repository: { owner: "acme", name: "repo", remote: { name: "origin", url: "https://example.test/repo.git" }, defaultBranch: "main" } };
const authority = (overrides: Partial<{ profileName: string; commonDirectory: string; profileFingerprint: string; actorLogin: string; topology: typeof topology }> = {}) => ({ profileName: "p", commonDirectory: "/repo/.git", profileFingerprint: "0".repeat(64), actorLogin: "actor", topology, ...overrides });

test("rejects traversal delivery IDs before creating any guard filesystem state", async () => {
  const fs = new MemoryFilesystem();
  const guard = new DevelopmentRecordGuard(new MutationLockService(fs, new FakeProcess()), { resolve: async () => ({ profileName: "p", commonDirectory: "/repo/.git", profileFingerprint: "0".repeat(64), actorLogin: "actor", topology: { kind: "single-repository", repository: { owner: "acme", name: "repo", remote: { name: "origin", url: "https://example.test/repo.git" }, defaultBranch: "main" } } }) });
  await assert.rejects(guard.run("/repo", "../../escape", async () => undefined));
  assert.equal(fs.files.size, 0); assert.equal(fs.directories.size, 0);
});

test("rejects authority drift after acquiring the guard lock before invoking the provider callback", async () => {
  const fs = new MemoryFilesystem(); let resolves = 0; let callbackCalls = 0;
  const guard = new DevelopmentRecordGuard(new MutationLockService(fs, new FakeProcess()), {
    async resolve() { resolves += 1; return resolves === 1 ? authority() : authority({ actorLogin: "different-actor" }); },
  });

  await assert.rejects(guard.run("/repo", "d-1", async () => { callbackCalls += 1; }), (error: unknown) => error instanceof GitHubTrackerError && error.code === "authority-mismatch");
  assert.equal(callbackCalls, 0);
  assert.equal(resolves, 2);
});
