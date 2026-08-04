import assert from "node:assert/strict";
import test from "node:test";
import { ActiveDevelopmentTrackingAuthorityResolver } from "../../src/github/tracking-authority.js";
import { GitHubTrackerError } from "../../src/github/markers.js";

const topology = { kind: "single-repository" as const, repository: { owner: "acme", name: "development", remote: { name: "origin", url: "https://example.test/development.git" }, defaultBranch: "main" } };
const binding = { schemaVersion: 1 as const, profileName: "p", commonDirectory: "/repo/.git", topology, profileFingerprint: "0".repeat(64), boundAt: "2026-08-04T00:00:00.000Z" };
const delivery = { binding, workspace: { schemaVersion: 1 as const, state: "ready" as const, creationToken: "11111111-1111-4111-8111-111111111111", deliveryId: "d-1", commonDirectory: "/repo/.git", branch: "shipyard/d-1", worktreePath: "/worktree" } };
const bound = { resolve: async () => ({ profileName: "p", commonDirectory: "/repo/.git", profileFingerprint: "0".repeat(64), actorLogin: "actor", topology }) };

test("derives trusted refs only from a live canonical worktree and branch head", async () => {
  const git = { worktreeIdentity: async () => ({ commonDirectory: "/repo/.git", branch: "shipyard/d-1" }), productHead: async () => "a".repeat(40), branchHead: async () => "a".repeat(40) };
  const result = await new ActiveDevelopmentTrackingAuthorityResolver({ resolve: async () => delivery } as never, bound, git).resolve("/worktree", "d-1");
  assert.deepEqual({ head: result.head, base: result.base, expectedHeadSha: result.expectedHeadSha }, { head: "shipyard/d-1", base: "main", expectedHeadSha: "a".repeat(40) });
});

test("accepts a canonical SHA-256 worktree and branch head", async () => {
  const git = { worktreeIdentity: async () => ({ commonDirectory: "/repo/.git", branch: "shipyard/d-1" }), productHead: async () => "a".repeat(64), branchHead: async () => "a".repeat(64) };
  const result = await new ActiveDevelopmentTrackingAuthorityResolver({ resolve: async () => delivery } as never, bound, git).resolve("/worktree", "d-1");
  assert.equal(result.expectedHeadSha, "a".repeat(64));
});

test("rejects detached/wrong worktree identity, stale branch head, and unsafe default base before provider use", async () => {
  const cases = [
    { worktreeIdentity: async () => undefined, productHead: async () => "a".repeat(40), branchHead: async () => "a".repeat(40) },
    { worktreeIdentity: async () => ({ commonDirectory: "/repo/.git", branch: "shipyard/d-1" }), productHead: async () => "a".repeat(40), branchHead: async () => "b".repeat(40) },
  ];
  for (const git of cases) await assert.rejects(new ActiveDevelopmentTrackingAuthorityResolver({ resolve: async () => delivery } as never, bound, git).resolve("/worktree", "d-1"), (error: unknown) => error instanceof GitHubTrackerError && error.code === "authority-mismatch");
  const unsafe = { ...delivery, binding: { ...binding, topology: { ...topology, repository: { ...topology.repository, defaultBranch: "fork:main" } } } };
  await assert.rejects(new ActiveDevelopmentTrackingAuthorityResolver({ resolve: async () => unsafe } as never, { resolve: async () => ({ ...await bound.resolve(), topology: unsafe.binding.topology }) }, cases[1]).resolve("/worktree", "d-1"), (error: unknown) => error instanceof GitHubTrackerError && error.code === "noncanonical-ref");
});
