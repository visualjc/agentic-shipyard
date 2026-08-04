import assert from "node:assert/strict";
import { access, lstat, mkdtemp, readFile, readlink, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = process.cwd();
const skills = ["shipyard", "shipyard-setup", "shipyard-status", "shipyard-sync", "shipyard-help"];

test("official Codex discovery paths point only at canonical skills with invocation metadata", async () => {
  for (const skill of skills) {
    const skillFile = `${root}/skills/${skill}/SKILL.md`;
    const discoveryPath = `${root}/.agents/skills/${skill}`;
    const text = await readFile(skillFile, "utf8");
    assert.match(text, /^---[\s\S]*metadata:[\s\S]*invocation:/, `${skill} metadata`);
    assert.ok((await lstat(discoveryPath)).isSymbolicLink(), `${skill} must be a repository discovery symlink`);
    assert.equal(await readlink(discoveryPath), `../../skills/${skill}`);
    assert.equal(await readFile(`${discoveryPath}/SKILL.md`, "utf8"), text, `${skill} resolves to its canonical package`);
    const openai = await readFile(`${root}/skills/${skill}/agents/openai.yaml`, "utf8");
    assert.match(openai, /^display_name: .+\nshort_description: .+\ndefault_prompt: .+\ninvocation_policy: explicit\n$/);
    if (skill !== "shipyard") await access(`${root}/skills/${skill}/references`);
  }
});

test("a simulated user .agents layout discovers symlinked canonical packages without duplicates", async () => {
  const userRoot = await mkdtemp(join(tmpdir(), "shipyard-user-skills-"));
  try {
    const userSkills = join(userRoot, ".agents", "skills");
    await (await import("node:fs/promises")).mkdir(userSkills, { recursive: true });
    for (const skill of skills) {
      const target = join(root, "skills", skill);
      const link = join(userSkills, skill);
      await symlink(target, link);
      assert.ok((await lstat(link)).isSymbolicLink());
      assert.equal(await readFile(join(link, "SKILL.md"), "utf8"), await readFile(join(target, "SKILL.md"), "utf8"));
    }
  } finally { await rm(userRoot, { recursive: true, force: true }); }
});
