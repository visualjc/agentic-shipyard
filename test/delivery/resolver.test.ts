import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryError } from "../../src/delivery/errors.js";
import { DeliveryResolver } from "../../src/delivery/resolver.js";
import type { DeliveryRegistryDocument, DeliveryWorkspace } from "../../src/delivery/types.js";
import { BindingService } from "../../src/binding/service.js";
import { FakeGit, MemoryBindingStore } from "../helpers/fakes.js";

const commonDirectory = "/repos/widget/.git";
const topology = { kind: "single-repository", repository: { owner: "test", name: "widget", remote: { name: "origin", url: "https://example.test/widget.git" }, defaultBranch: "main" } } as const;
const workspace = (overrides: Partial<DeliveryWorkspace> = {}): DeliveryWorkspace => ({ schemaVersion: 1, state: "ready", creationToken: "11111111-1111-4111-8111-111111111111", deliveryId: "delivery-001", commonDirectory, branch: "shipyard/delivery-001", worktreePath: "/worktrees/delivery-001", ...overrides });

class Registry {
  reads = 0;
  constructor(public document: DeliveryRegistryDocument | undefined) {}
  async lockScope() { return { path: "/state/deliveries.json.lock", scope: "/state/deliveries.json" }; }
  async read() { this.reads += 1; return this.document; }
  async write(document: DeliveryRegistryDocument) { this.document = document; }
}

function makeResolver(document: DeliveryRegistryDocument | undefined, readinessValid = true) {
  const git = new FakeGit();
  for (const path of ["/main", "/worktrees/delivery-001", "/worktrees/delivery-002", "/wrong-worktree"]) {
    git.commonDirectories.set(path, commonDirectory);
    git.remotes.set(`${path}:origin`, "https://example.test/widget.git");
  }
  const bindings = new BindingService(new MemoryBindingStore({ schemaVersion: 1, bindings: [{ schemaVersion: 1, profileName: "test", commonDirectory, topology, profileFingerprint: "0".repeat(64), boundAt: "2026-08-04T00:00:00.000Z" }] }), git);
  const registry = new Registry(document);
  const readiness = { calls: 0, async verifyReadyWorkspace() { this.calls += 1; return readinessValid; } };
  return { registry, readiness, resolver: new DeliveryResolver(bindings, registry, readiness) };
}

test("resolves a linked worktree through its canonical common-directory binding", async () => {
  const { resolver } = makeResolver({ schemaVersion: 1, workspaces: [workspace()] });
  const result = await resolver.resolve({ repositoryPath: "/worktrees/delivery-001" });
  assert.equal(result.workspace.deliveryId, "delivery-001");
  assert.equal(result.binding.commonDirectory, commonDirectory);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.workspace));
  assert.ok(Object.isFrozen(result.binding.topology));
});

test("selects an explicit ID within the same bound repository even from its main clone", async () => {
  const { resolver } = makeResolver({ schemaVersion: 1, workspaces: [workspace()] });
  assert.equal((await resolver.resolve({ repositoryPath: "/main", deliveryId: "delivery-001" })).workspace.worktreePath, "/worktrees/delivery-001");
  await assert.rejects(resolver.resolve({ repositoryPath: "/main", deliveryId: "missing" }), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-not-found");
});

test("rejects missing, ambiguous, invalid, and worktree-mismatched registrations", async () => {
  await assert.rejects(makeResolver(undefined).resolver.resolve({ repositoryPath: "/main" }), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-registry-missing");
  await assert.rejects(makeResolver({ schemaVersion: 1, workspaces: [] }).resolver.resolve({ repositoryPath: "/main" }), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-not-found");
  await assert.rejects(makeResolver({ schemaVersion: 1, workspaces: [workspace(), workspace({ deliveryId: "delivery-002", branch: "shipyard/delivery-002", worktreePath: "/worktrees/delivery-002" })] }).resolver.resolve({ repositoryPath: "/main" }), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-ambiguous");
  await assert.rejects(makeResolver({ schemaVersion: 1, workspaces: [workspace({ commonDirectory: "/other/.git" })] }).resolver.resolve({ repositoryPath: "/worktrees/delivery-001" }), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-worktree-mismatch");
  await assert.rejects(makeResolver({ schemaVersion: 1, workspaces: [workspace()] }).resolver.resolve({ repositoryPath: "/wrong-worktree" }), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-worktree-mismatch");
  await assert.rejects(makeResolver({ schemaVersion: 1, workspaces: [{ ...workspace(), branch: "" }] as never }).resolver.resolve({ repositoryPath: "/main", deliveryId: "delivery-001" }), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-registry-invalid");
});

test("recomputes from the registry for every resolve and never reuses a mutable record", async () => {
  const { registry, resolver: deliveryResolver } = makeResolver({ schemaVersion: 1, workspaces: [workspace()] });
  const first = await deliveryResolver.resolve({ repositoryPath: "/main", deliveryId: "delivery-001" });
  registry.document = { schemaVersion: 1, workspaces: [workspace({ worktreePath: "/worktrees/delivery-001-recomputed" })] };
  const second = await deliveryResolver.resolve({ repositoryPath: "/main", deliveryId: "delivery-001" });
  assert.equal(registry.reads, 2);
  assert.equal(first.workspace.branch, "shipyard/delivery-001");
  assert.equal(second.workspace.worktreePath, "/worktrees/delivery-001-recomputed");
  assert.notStrictEqual(first.workspace, second.workspace);
});

test("does not resolve an interrupted creating claim", async () => {
  await assert.rejects(makeResolver({ schemaVersion: 1, workspaces: [workspace({ state: "creating" })] }).resolver.resolve({ repositoryPath: "/main", deliveryId: "delivery-001" }), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-incomplete");
});

test("does not resolve a ready registration with missing or mismatched durable proofs", async () => {
  const { readiness, resolver } = makeResolver({ schemaVersion: 1, workspaces: [workspace()] }, false);
  await assert.rejects(resolver.resolve({ repositoryPath: "/main", deliveryId: "delivery-001" }), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-incomplete");
  assert.equal(readiness.calls, 1);
});
