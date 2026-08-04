import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package barrel exposes only the controlled graph lane, not raw mutation adapters", async () => {
  const barrel = await readFile(new URL("../../../src/index.ts", import.meta.url), "utf8");
  const adapterSurfaces = await Promise.all(["graphify", "codegraph"].map(name => readFile(new URL(`../../../src/adapters/${name}.ts`, import.meta.url), "utf8")));
  assert.doesNotMatch([barrel, ...adapterSurfaces].join("\n"), /export \{[^\n]*(?:refreshGraph|refreshGraphify|seedGraphify|refreshCodeGraph|seedCodeGraph)/);
  assert.match(barrel, /export \{ createGraphLaneService \}/);
});
