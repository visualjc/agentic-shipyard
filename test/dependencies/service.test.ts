import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DependencyStatusService } from "../../src/dependencies/service.js";
import type { ObservedDependencyReceipt } from "../../src/dependencies/types.js";

const manifest = JSON.parse(await readFile(new URL("../../config/capabilities.v1.json", import.meta.url), "utf8"));
const matt = manifest.dependencies[0], ccpm = manifest.dependencies[1], codex = manifest.dependencies[2];
const exact = [
  { id: "matt-skills", source: matt.source, content: matt.content, discoveryPaths: matt.canonicalDiscovery, invocation: { command: "skills", frontmatterName: "wayfinder" }, skillMetadata: matt.content.skills.map((skill: any) => ({ name: skill.name, frontmatterName: skill.name, files: skill.requiredFiles })), runtimes: [{ kind: "runtime-version", host: "codex", version: "0.144.4" }] },
  { id: "ccpm", source: ccpm.source, content: ccpm.content, discoveryPaths: ccpm.canonicalDiscovery, invocation: { command: "ccpm", frontmatterName: "ccpm" }, runtimes: [{ kind: "runtime-version", host: "codex", version: "0.144.4" }] },
  { id: "codex", content: codex.content, discoveryPaths: [], invocation: { command: "skills", frontmatterName: "codex" }, runtimes: [{ kind: "runtime-version", host: "codex", version: "0.144.4" }] },
];
test("status service receives detached observations and never asks its observer to repair", async () => {
  let calls = 0;
  const service = new DependencyStatusService({ async inspect() { calls++; return structuredClone(exact) as ObservedDependencyReceipt[]; } }, manifest);
  const result = await service.inspect({ host: "codex", lane: "large" });
  assert.equal(calls, 1); assert.equal(result.ready, true); assert.equal(result.nextSafeAction, "shipyard");
  assert.equal(Object.isFrozen(result), true);
});
test("unsupported hosts are a deterministic blocker, not an installation action", async () => {
  const service = new DependencyStatusService({ async inspect() { return structuredClone(exact) as ObservedDependencyReceipt[]; } }, manifest);
  const result = await service.inspect({ host: "claude-code", lane: "large" });
  assert.equal(result.ready, false);
  assert.deepEqual(result.findings.map(value => value.state), ["incompatible"]);
});
test("hostile selected documents are rejected before observer access", async () => {
  let called = false;
  const service = new DependencyStatusService({ async inspect() { called = true; return []; } }, manifest);
  await assert.rejects(service.inspect(new Proxy({}, { get() { throw new Error("getter"); } }) as never));
  assert.equal(called, false);
});
test("observer failures are redacted into fixed non-authorizing guidance", async () => {
  const service = new DependencyStatusService({ async inspect() { throw new Error("/private/path token=secret"); } }, manifest);
  const result = await service.inspect({ host: "codex", lane: "small" });
  assert.deepEqual(result.findings.map(value => value.state), ["missing"]);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
