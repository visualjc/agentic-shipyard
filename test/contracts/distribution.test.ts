import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
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
    "shipyard-skills-install": "./bin/shipyard-skills-install",
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
    "skills/shipyard/agents/openai.yaml",
    "skills/shipyard-setup/agents/openai.yaml",
    "skills/shipyard-status/agents/openai.yaml",
    "skills/shipyard-help/agents/openai.yaml",
    "docs/setup.md",
    "docs/status.md",
    "docs/help.md",
    "docs/metadata-ownership.md",
    "docs/skills.md",
  ];
  for (const path of expectedContent) assert.ok(entries.has(path), `missing package content ${path}`);
  assert.equal([...entries.keys()].some((path) => path.startsWith("src/") || path.startsWith("test/") || path.startsWith("dist/test/")), false);
  assert.equal([...entries.keys()].some((path) => path.startsWith(".agents/")), false, "npm must not claim to ship source-checkout symlinks");
});

test("public package API excludes raw REST and credentialed Git runner bypasses", async () => {
  const api = await import("../../src/index.js");
  for (const name of ["GitHubRestAdapter", "FetchGitHubRestTransport", "createNodeGitTransportCommandRunner", "nodeGitTransportCommandRunner", "DEFAULT_NODE_GIT_EXECUTABLE"])
    assert.equal(name in api, false, `${name} must remain internal`);
  assert.equal("GitTransportService" in api, true);
});

test("public type surface lets a consumer implement the workspace Git port", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "shipyard-public-types-"));
  try {
    const entry = join(packageRoot, "dist", "src", "index.js");
    const fixture = join(sandbox, "consumer.mts");
    await writeFile(fixture, [
      `import type { WorkspaceGit, WorktreeEnsureIntent } from ${JSON.stringify(entry)};`,
      "const intent: WorktreeEnsureIntent = { mode: \"create\", startSha: \"a\".repeat(40) };",
      "const port: Pick<WorkspaceGit, \"ensureWorktree\"> = {",
      "  async ensureWorktree(_repositoryPath, _branch, _path, received) {",
      "    return received.mode === intent.mode;",
      "  },",
      "};",
      "void port;",
    ].join("\n"), "utf8");
    await execFileAsync(join(packageRoot, "node_modules", ".bin", "tsc"), ["--noEmit", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--strict", fixture], { encoding: "utf8" });
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test("packaged skill installer creates only exact canonical discovery symlinks", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "shipyard-pack-"));
  try {
    const { stdout } = await execFileAsync("npm", ["pack", "--json"], { cwd: packageRoot, encoding: "utf8" });
    const tarball = join(packageRoot, (JSON.parse(stdout) as Array<{ filename: string }>)[0].filename);
    const installRoot = join(sandbox, "installed");
    const projectRoot = join(sandbox, "project");
    const userRoot = join(sandbox, "user");
    await execFileAsync("npm", ["install", "--ignore-scripts", "--prefix", installRoot, tarball], { encoding: "utf8" });
    const installer = join(installRoot, "node_modules", "@visualjc", "shipyard", "bin", "shipyard-skills-install");
    const installedSkills = join(installRoot, "node_modules", "@visualjc", "shipyard", "skills");
    for (const root of [projectRoot, userRoot]) {
      await execFileAsync(process.execPath, [installer, root === projectRoot ? "--target" : "--home", root], { encoding: "utf8" });
      await execFileAsync(process.execPath, [installer, root === projectRoot ? "--target" : "--home", root], { encoding: "utf8" });
      for (const skill of ["shipyard", "shipyard-setup", "shipyard-status", "shipyard-help"]) {
        const link = join(root, ".agents", "skills", skill);
        assert.ok((await lstat(link)).isSymbolicLink());
        assert.equal(await readlink(link), await (await import("node:fs/promises")).realpath(join(installedSkills, skill)));
        await readFile(join(link, "SKILL.md"), "utf8");
        await readFile(join(link, "agents", "openai.yaml"), "utf8");
      }
    }
    const refusal = join(projectRoot, ".agents", "skills", "shipyard");
    await rm(refusal);
    await writeFile(refusal, "do not replace");
    await assert.rejects(execFileAsync(process.execPath, [installer, "--target", projectRoot]), /Refusing to replace existing/);

    for (const option of ["--target", "--home"]) {
      const cwd = join(sandbox, `untouched-${option.slice(2)}`);
      await (await import("node:fs/promises")).mkdir(cwd);
      await assert.rejects(execFileAsync(process.execPath, [installer, option], { cwd }), /requires a non-empty path/);
      await assert.rejects(lstat(join(cwd, ".agents")), { code: "ENOENT" });
      await assert.rejects(execFileAsync(process.execPath, [installer, option, ""], { cwd }), /requires a non-empty path/);
      await assert.rejects(lstat(join(cwd, ".agents")), { code: "ENOENT" });
      await assert.rejects(execFileAsync(process.execPath, [installer, option, "--home", userRoot], { cwd }), /requires a non-empty path/);
      await assert.rejects(lstat(join(cwd, ".agents")), { code: "ENOENT" });
    }
    await assert.rejects(execFileAsync(process.execPath, [installer, "--target", projectRoot, "--home", userRoot]), /Use either --target or --home/);

    const wrongLink = join(userRoot, ".agents", "skills", "shipyard-help");
    await rm(wrongLink);
    await symlink("/not-the-packaged-skill", wrongLink);
    await assert.rejects(execFileAsync(process.execPath, [installer, "--home", userRoot]), /different target/);
    assert.equal(await readlink(wrongLink), "/not-the-packaged-skill");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    const packs = await (await import("node:fs/promises")).readdir(packageRoot);
    await Promise.all(packs.filter((file) => /^visualjc-shipyard-.*\.tgz$/.test(file)).map((file) => rm(join(packageRoot, file), { force: true })));
  }
});

test("core status module has no upward barrel or Node git adapter dependency", async () => {
  const visited = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /from ["'][^"']*index\.js["']/);
    assert.doesNotMatch(source, /node:child_process/);
    const imports = [...source.matchAll(/from ["'](\.{1,2}\/[^"']+\.js)["']/g)].map((match) => match[1]);
    await Promise.all(imports.map((specifier) => visit(join(dirname(path), specifier))));
  };
  await visit(join(packageRoot, "dist", "src", "commands", "status.js"));
  assert.equal([...visited].some((path) => path.endsWith("/adapters/git.js")), false);
});

test("public package import does not resolve the default Git executable", async () => {
  const entry = pathToFileURL(join(packageRoot, "dist", "src", "index.js")).href;
  const preload = [
    "const fs = require('node:fs');",
    "const original = fs.realpathSync;",
    "fs.realpathSync = (path, ...rest) => { if (path === '/usr/bin/git') throw new Error('simulated missing default Git'); return original(path, ...rest); };",
    "import(process.argv[1]).catch(error => { console.error(error); process.exitCode = 1; });",
  ].join(" ");
  await execFileAsync(process.execPath, ["-e", preload, entry], { encoding: "utf8" });
});
