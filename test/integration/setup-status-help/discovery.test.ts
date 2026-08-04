import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();
const skills = ["shipyard", "shipyard-setup", "shipyard-status", "shipyard-help"];

test("each setup/status/help skill has Codex invocation metadata and focused references", async () => {
  for (const skill of skills) {
    const skillFile = `${root}/skills/${skill}/SKILL.md`;
    const text = await readFile(skillFile, "utf8");
    assert.match(text, /^---[\s\S]*metadata:[\s\S]*invocation:/, `${skill} metadata`);
    if (skill !== "shipyard") await access(`${root}/skills/${skill}/references`);
  }
});
