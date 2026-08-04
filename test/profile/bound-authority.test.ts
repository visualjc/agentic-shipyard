import assert from "node:assert/strict";
import test from "node:test";
import { BindingService } from "../../src/binding/service.js";
import { BindingError } from "../../src/binding/errors.js";
import { profileFingerprint } from "../../src/profile/fingerprint.js";
import { ActiveBoundProfileAuthorityResolver } from "../../src/profile/bound-authority.js";
import type { Profile } from "../../src/contracts/types.js";
import { FakeGit, MemoryBindingStore } from "../helpers/fakes.js";

const repository = { owner: "acme", name: "development", remote: { name: "origin", url: "https://example.test/development.git" }, defaultBranch: "main" };
const profile = (): Profile => ({ schemaVersion: 1, name: "trusted", actor: { login: "trusted-actor" }, topology: { kind: "single-repository", repository }, allowedOperations: ["review"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] } });

function fixture(current: Profile = profile()) {
  const git = new FakeGit(); git.commonDirectories.set("/worktree", "/worktree/.git"); git.remotes.set("/worktree:origin", repository.remote.url);
  const binding = { schemaVersion: 1 as const, profileName: "trusted", commonDirectory: "/worktree/.git", topology: current.topology, profileFingerprint: profileFingerprint(current), boundAt: "2026-08-04T00:00:00.000Z" };
  const bindings = new BindingService(new MemoryBindingStore({ schemaVersion: 1, bindings: [binding] }), git);
  return { resolver: new ActiveBoundProfileAuthorityResolver(bindings, { read: async () => current }), bindings, binding };
}

test("derives immutable actor and topology only from the actively linked binding/profile", async () => {
  const { resolver, binding } = fixture();
  const authority = await resolver.resolve("/worktree", "review");
  assert.equal(authority.actorLogin, "trusted-actor");
  assert.deepEqual(authority.topology, binding.topology);
  assert.ok(Object.isFrozen(authority)); assert.ok(Object.isFrozen(authority.topology));
});

test("rejects a wrong active profile actor or topology even when the binding name is unchanged", async () => {
  for (const changed of [
    { ...profile(), actor: { login: "forged-actor" } },
    { ...profile(), topology: { kind: "single-repository" as const, repository: { ...repository, name: "other", remote: { name: "origin", url: "https://example.test/other.git" } } } },
  ]) {
    const { bindings } = fixture(profile());
    // Keep the persisted binding/profile fingerprint from the original profile,
    // then replace only the profile returned at runtime.
    const forged = new ActiveBoundProfileAuthorityResolver(bindings, { read: async () => changed });
    await assert.rejects(forged.resolve("/worktree", "review"), (error: unknown) => error instanceof BindingError && error.code === "binding-stale");
  }
});
