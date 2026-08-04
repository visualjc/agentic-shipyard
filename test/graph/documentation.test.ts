import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

// Tests run from dist/test/graph; source and built paths are intentionally
// anchored at the repository root rather than the transpiled directory.
const root = resolve(import.meta.dirname, "../../..");
async function document(name: string): Promise<string> { return readFile(resolve(root, "docs", name), "utf8"); }

test("experimental graph documentation and package policy retain the reviewed safety contract", async () => {
  const [graphify, codegraph, ownership, readme, manifest] = await Promise.all([
    document("graphify-experimental.md"), document("codegraph-experimental.md"), document("metadata-ownership.md"), readFile(resolve(root, "README.md"), "utf8"), readFile(resolve(root, "package.json"), "utf8"),
  ]);
  for (const text of [graphify, codegraph]) assert.match(text, /disabled by default/i);
  assert.match(graphify, /code-only/i); assert.match(graphify, /GRAPHIFY_OUT/); assert.match(graphify, /--out/); assert.match(graphify, /query logging/i); assert.match(graphify, /graphify-out\/\*\*/); assert.match(graphify, /no code, query, image,\s*or document may be sent to a provider/i);
  assert.match(codegraph, /SQLite FTS5/i); assert.match(codegraph, /info\/exclude/); assert.match(codegraph, /empirical observation/i); assert.match(codegraph, /not an upstream-guaranteed/i); assert.match(codegraph, /No installer, MCP setup, or\s*provider transmission/i);
  assert.match(ownership, /Understand Anything has no authoritative feature-worktree state/i); assert.doesNotMatch(graphify + codegraph + readme, /Understand Anything.*adapter/i);
  const files = JSON.parse(manifest) as { files: string[] };
  for (const required of ["docs", "README.md"]) assert.ok(files.files.includes(required));
});
