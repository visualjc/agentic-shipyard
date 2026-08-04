import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const skills = [
  ["shipyard", "shipyard <request>", "references/orchestration.md", "run the command returned by `shipyard`"],
  ["shipyard-setup", "shipyard-setup", "references/setup.md", "run `shipyard-status`"],
  ["shipyard-status", "shipyard-status", "references/status.md", "command returned by `shipyard-status`"],
  ["shipyard-review", "shipyard-review", "references/review.md", "command returned by `shipyard-review`"],
  ["shipyard-sync", "shipyard-sync", "references/sync.md", "command returned by `shipyard-sync`"],
  ["shipyard-promote", "shipyard-promote", "references/promotion.md", "command returned by `shipyard-promote`"],
  ["shipyard-finalize", "shipyard-finalize", "references/finalization.md", "command returned by `shipyard-finalize`"],
  ["shipyard-help", "shipyard-help <command>", "references/help.md", "invoke the selected public"],
] as const;

test("each public skill is a focused progressive Codex v1 load", async () => {
  for (const [name, invocation, reference, nextAction] of skills) {
    const directory = join(root, "skills", name);
    const skill = await readFile(join(directory, "SKILL.md"), "utf8");
    const metadata = await readFile(join(directory, "agents", "openai.yaml"), "utf8");
    const focusedReference = await readFile(join(directory, reference), "utf8");
    assert.match(skill, new RegExp(`^---\\nname: ${name}\\n[\\s\\S]*metadata:\\n  invocation: ${invocation.replace(/[<>]/g, "\\$&")}\\n---`, "m"));
    assert.match(skill, new RegExp(`\\[[^\\]]+\\]\\(${reference.replace("/", "\\/")}\\)`));
    assert.match(metadata, /^display_name: .+\nshort_description: .+\ndefault_prompt: .+\ninvocation_policy: explicit\n$/);
    assert.match(focusedReference, new RegExp(nextAction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "\\s+"), "i"));
    assert.deepEqual((await readdir(join(directory, "references"))).sort(), [reference.split("/").at(-1)!]);
  }
});

test("skills route to Shipyard and do not duplicate raw authority workflows", async () => {
  const source = await Promise.all(skills.map(async ([name, , reference]) => [
    await readFile(join(root, "skills", name, "SKILL.md"), "utf8"),
    await readFile(join(root, "skills", name, reference), "utf8"),
  ]));
  for (const [skill, reference] of source) {
    const text = `${skill}\n${reference}`;
    assert.doesNotMatch(text, /\bgh\s+/i);
    assert.doesNotMatch(text, /\bgit\s+(push|fetch|merge|rebase|checkout|commit)\b/i);
    assert.doesNotMatch(text, /\bccpm\s*[:/]/i);
    assert.doesNotMatch(text, /(?:token|profile)\s*=/i);
    assert.doesNotMatch(text, /\bmerge\s+(?:this|the)?\s*(?:pr|pull request|branch)/i);
  }
});

test("host and migration guidance remains explicitly unsupported outside Codex v1", async () => {
  const planning = await readFile(join(root, "docs", "planning-lanes.md"), "utf8");
  const help = await readFile(join(root, "skills", "shipyard-help", "references", "help.md"), "utf8");
  const rootSkill = await readFile(join(root, "skills", "shipyard", "SKILL.md"), "utf8");
  const combined = `${planning}\n${help}\n${rootSkill}`;
  assert.match(combined, /Codex CLI.*only supported live.*v1/i);
  assert.match(combined, /Claude Code[\s\S]*Cursor\/Pstack[\s\S]*deferred and unsupported/i);
  assert.match(combined, /multi-account routing[\s\S]*deferred and unsupported/i);
  assert.match(combined, /legacy `\/pm:\*` aliases[\s\S]*deferred and unsupported/i);
});
