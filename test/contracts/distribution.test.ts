import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

type PackageManifest = {
  exports: Record<string, string>;
  bin: Record<string, string>;
};
type PackEntry = { path: string; mode: number };
type PackResult = { files: PackEntry[] };

test("packed package contains runnable public API, commands, skills, and focused docs only", async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as PackageManifest;
  assert.deepEqual(manifest.bin, {
    shipyard: "./bin/shipyard",
    "shipyard-setup": "./bin/shipyard-setup",
    "shipyard-status": "./bin/shipyard-status",
    "shipyard-help": "./bin/shipyard-help",
  });

  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  const [packed] = JSON.parse(stdout) as PackResult[];
  const entries = new Map(packed.files.map((entry) => [entry.path, entry]));

  for (const target of Object.values(manifest.exports)) {
    assert.ok(entries.has(target.replace(/^\.\//, "")), `missing exported target ${target}`);
  }
  for (const [name, target] of Object.entries(manifest.bin)) {
    const path = target.replace(/^\.\//, "");
    assert.ok(entries.has(path), `missing ${name} launcher`);
    assert.notEqual((await stat(join(packageRoot, path))).mode & 0o111, 0, `${name} source launcher is not executable`);
    assert.notEqual(entries.get(path)!.mode & 0o111, 0, `${name} packed launcher is not executable`);
  }

  const expectedContent = [
    "skills/shipyard/SKILL.md",
    "skills/shipyard-setup/SKILL.md",
    "skills/shipyard-status/SKILL.md",
    "skills/shipyard-help/SKILL.md",
    "docs/setup.md",
    "docs/status.md",
    "docs/help.md",
    "docs/metadata-ownership.md",
  ];
  for (const path of expectedContent) assert.ok(entries.has(path), `missing package content ${path}`);
  assert.equal([...entries.keys()].some((path) => path.startsWith("src/") || path.startsWith("test/") || path.startsWith("dist/test/")), false);
});
