import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryError } from "../../src/delivery/errors.js";
import { JsonDeliveryRegistry, newDeliveryRegistryDocument, validateDeliveryRegistryDocument } from "../../src/delivery/registry.js";
import type { DeliveryWorkspace } from "../../src/delivery/types.js";
import { MemoryFilesystem } from "../helpers/fakes.js";

const workspace = (overrides: Partial<DeliveryWorkspace> = {}): DeliveryWorkspace => ({
  schemaVersion: 1,
  state: "ready",
  creationToken: "11111111-1111-4111-8111-111111111111",
  deliveryId: "delivery-001",
  commonDirectory: "/repos/widget/.git",
  branch: "shipyard/delivery-001",
  worktreePath: "/worktrees/delivery-001",
  ...overrides,
});

test("validates versioned local workspace records and preserves independent snapshots", () => {
  const document = newDeliveryRegistryDocument([workspace()]);
  const validated = validateDeliveryRegistryDocument(document)!;
  assert.deepEqual(validated, document);
  assert.notStrictEqual(validated.workspaces, document.workspaces);
  assert.throws(() => validateDeliveryRegistryDocument({ schemaVersion: 2, workspaces: [] }), DeliveryError);
  assert.throws(() => validateDeliveryRegistryDocument({ schemaVersion: 1, workspaces: [{ ...workspace(), unknown: true }] }), DeliveryError);
  assert.throws(() => validateDeliveryRegistryDocument({ schemaVersion: 1, workspaces: [{ ...workspace(), creationToken: "not-a-token" }] }), DeliveryError);
});

test("rejects duplicate delivery IDs and duplicate linked-worktree registrations", () => {
  assert.throws(
    () => validateDeliveryRegistryDocument({ schemaVersion: 1, workspaces: [workspace(), workspace({ worktreePath: "/other" })] }),
    (error: unknown) => error instanceof DeliveryError && error.code === "delivery-duplicate",
  );
  assert.throws(
    () => validateDeliveryRegistryDocument({ schemaVersion: 1, workspaces: [workspace(), workspace({ deliveryId: "delivery-002", branch: "shipyard/delivery-002" })] }),
    (error: unknown) => error instanceof DeliveryError && error.code === "delivery-duplicate",
  );
});

test("rejects non-canonical delivery identifiers, branches, and equivalent path aliases", () => {
  assert.throws(() => newDeliveryRegistryDocument([workspace({ deliveryId: "../escape", branch: "shipyard/../escape" })]), DeliveryError);
  assert.throws(() => newDeliveryRegistryDocument([workspace({ branch: "feature/unrelated" })]), DeliveryError);
  assert.throws(() => newDeliveryRegistryDocument([workspace({ worktreePath: "/worktrees/../delivery-001" })]), DeliveryError);
  assert.throws(() => newDeliveryRegistryDocument([workspace({ worktreePath: "/worktrees/delivery-001/" })]), DeliveryError);
  assert.throws(() => newDeliveryRegistryDocument([workspace({ commonDirectory: "/repos/widget/.git/" })]), DeliveryError);
});

test("filesystem registry rejects malformed persisted JSON and validates before persistence", async () => {
  const filesystem = new MemoryFilesystem();
  const registry = new JsonDeliveryRegistry(filesystem, "/state/deliveries.json");
  assert.deepEqual(await registry.lockScope(), { path: "/state/deliveries.json.lock", scope: "/state/deliveries.json" });
  assert.equal(await registry.read(), undefined);
  filesystem.files.set("/state/deliveries.json", "{");
  await assert.rejects(registry.read(), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-registry-invalid");
  await assert.rejects(registry.write({ schemaVersion: 1, workspaces: [{ ...workspace(), deliveryId: "" }] }), (error: unknown) => error instanceof DeliveryError && error.code === "delivery-registry-invalid");
  await registry.write(newDeliveryRegistryDocument([workspace()]));
  assert.deepEqual(await registry.read(), newDeliveryRegistryDocument([workspace()]));
});
