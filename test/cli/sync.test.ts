import assert from "node:assert/strict";
import test from "node:test";
import { run } from "../../src/cli/main.js";

test("present but valueless or empty --source-ref never falls back to baseline sync", async () => {
  for (const argv of [["--source-ref"], ["--source-ref="], ["--source-ref", ""]]) {
    const result = await run(argv, "sync", "/definitely/not/a/repository");
    assert.equal(result.code, 1); assert.match(result.output, /--source-ref requires a non-empty value/i); assert.doesNotMatch(result.output, /repository identity|credential|baseline/i);
  }
});

test("sync rejects unknown, duplicate, positional, and multiple-value shapes before repository access", async () => {
  for (const argv of [
    ["--source_ref", "release"],
    ["--bogus"],
    ["--source-ref", "one", "--source-ref", "two"],
    ["--repo", "/one", "--repo", "/two"],
    ["release"],
    ["--source-ref", "one", "two"],
  ]) {
    const result = await run(argv, "sync", "/definitely/not/a/repository");
    assert.equal(result.code, 1); assert.match(result.output, /rejects (unknown|duplicate|unexpected|ambiguous)/i); assert.doesNotMatch(result.output, /repository identity|credential|baseline|binding/i);
  }
});
