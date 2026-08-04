import assert from "node:assert/strict";
import test from "node:test";
import { status } from "../../src/commands/status.js";
import { profileFingerprint } from "../../src/profile/fingerprint.js";
import type { Profile } from "../../src/contracts/types.js";
import type { SyncStatusReader } from "../../src/sync/status.js";
import { graphDecision } from "../../src/graph/freshness.js";

const repository = { owner: "acme", name: "product", remote: { name: "upstream", url: "https://github.com/acme/product.git" }, defaultBranch: "main" } as const;
const profile: Profile = { schemaVersion: 1, name: "trusted", actor: { login: "actor" }, topology: { kind: "single-repository", repository }, allowedOperations: ["status", "sync"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "**" }] } };
const binding = { schemaVersion: 1 as const, profileName: profile.name, commonDirectory: "/repo/.git", topology: profile.topology, profileFingerprint: profileFingerprint(profile), boundAt: "2026-08-04T00:00:00.000Z" };
const disabledGraph = { status: async () => ({ enabled: false, decision: graphDecision("disabled", "Graph acceleration is not required.") }) };

test("public status composes local sync facts without a mutation, provider, or delivery dependency", async () => {
  const calls: string[] = [];
  const reader: SyncStatusReader = { read: async request => { calls.push("sync-read"); assert.equal(request.repositoryPath, "/repo"); assert.equal(request.destinationRemote, "upstream"); return { baseline: "fresh", destinationSha: "b".repeat(40), nextSafeAction: "Continue safely." }; } };
  const result = await status(
    { resolve: async () => { calls.push("binding-read"); return binding; } },
    { commonDirectory: async () => { calls.push("common-directory-read"); return "/repo/.git"; }, remoteUrl: async () => { calls.push("remote-read"); return repository.remote.url; } },
    { read: async () => { calls.push("profile-read"); return profile; } },
    "/repo",
    reader,
    disabledGraph,
  );
  assert.equal(result.syncFreshness, "fresh"); assert.equal(result.graphFreshness, "disabled"); assert.equal(result.destinationSha, "b".repeat(40)); assert.equal(result.providerRefs?.sourceProvenance, "none"); assert.equal(result.nextSafeAction, "Continue safely."); assert.deepEqual(result.blockers, []);
  assert.deepEqual(calls, ["common-directory-read", "binding-read", "profile-read", "sync-read"]);
});

test("public status reports local sync blockers and next action instead of unconditional unavailable", async () => {
  const reader: SyncStatusReader = { read: async () => ({ baseline: "stale", destinationSha: "b".repeat(40), blocker: { code: "sync-dirty", message: "Worktree or index is dirty.", nextSafeAction: "Clean it explicitly." } }) };
  const result = await status({ resolve: async () => binding }, { commonDirectory: async () => "/repo/.git", remoteUrl: async () => repository.remote.url }, { read: async () => profile }, "/repo", reader, disabledGraph);
  assert.equal(result.syncFreshness, "stale"); assert.equal(result.graphFreshness, "disabled"); assert.deepEqual(result.blockers, [{ code: "sync-dirty", message: "Worktree or index is dirty." }]); assert.equal(result.nextSafeAction, "Clean it explicitly.");
});

test("a default-disabled graph preserves a stale sync action without inventing a blocker", async () => {
  const reader: SyncStatusReader = { read: async () => ({ baseline: "stale", destinationSha: "b".repeat(40), nextSafeAction: "Run shipyard-sync explicitly." }) };
  const result = await status({ resolve: async () => binding }, { commonDirectory: async () => "/repo/.git", remoteUrl: async () => repository.remote.url }, { read: async () => profile }, "/repo", reader, disabledGraph);
  assert.equal(result.syncFreshness, "stale"); assert.equal(result.graphFreshness, "disabled"); assert.equal(result.nextSafeAction, "Run shipyard-sync explicitly."); assert.deepEqual(result.blockers, []);
});
