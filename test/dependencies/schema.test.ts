import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateCapabilityManifest, validateObservedDependencyReceipt } from "../../src/dependencies/schema.js";

const manifest = JSON.parse(await readFile(new URL("../../config/capabilities.v1.json", import.meta.url), "utf8"));
test("manifest contains truthful exact Matt, CCPM, and runtime receipts", () => {
  const result = validateCapabilityManifest(manifest), matt = result.dependencies.find(item => item.id === "matt-skills")!, ccpm = result.dependencies.find(item => item.id === "ccpm")!;
  assert.equal(matt.content.kind, "matt-skill-trees"); assert.equal(matt.content.kind === "matt-skill-trees" && matt.content.skills.length, 20);
  assert.equal(ccpm.content.kind, "git-tree"); assert.equal(ccpm.content.kind && ccpm.content.treeSha, "72ea8594a5e4e592569b1c02e0918dc30760705f");
  assert.ok(JSON.stringify(manifest).includes("2ab958093e83e0ec752e6c1c5932da465bf23e0c")); assert.ok(!/[abc]{64}/.test(JSON.stringify(manifest)));
});
test("schema rejects hostile, sparse, unknown, cyclic and modified input", () => {
  assert.throws(() => validateCapabilityManifest({...manifest, extra: true}));
  assert.throws(() => validateCapabilityManifest({...manifest, dependencies: [{...manifest.dependencies[0], content: {...manifest.dependencies[0].content, skills: manifest.dependencies[0].content.skills.slice(1)}}]}));
  const getter: any = {}; Object.defineProperty(getter, "schemaVersion", { enumerable: true, get() { throw new Error("leak"); } }); assert.throws(() => validateCapabilityManifest(getter));
  const cycle: any = { id: "matt-skills" }; cycle.self = cycle; assert.throws(() => validateObservedDependencyReceipt(cycle));
  const sparse: any[] = []; sparse[1] = "x"; assert.throws(() => validateObservedDependencyReceipt({id:"matt-skills", discoveryPaths:sparse, runtimes:[]}));
});
