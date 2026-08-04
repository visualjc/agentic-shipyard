import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { nodeDependencyFilesystem, observedFrontmatterName, observedTreeSha, type DependencyFilesystem } from "../../src/adapters/dependency-filesystem.js";
import { NodeDependencyRuntime } from "../../src/adapters/dependency-runtime.js";
import { LocalDependencyObserver } from "../../src/dependencies/observer.js";
import { DependencyStatusService } from "../../src/dependencies/service.js";

type ManifestDocument = { dependencies: Array<{ id: string; source?: unknown; content: { kind: string; skills?: Array<{ name: string; sourcePath: string; treeSha: string; requiredFiles: string[] }>; treeSha?: string; requiredFiles?: string[] }; canonicalDiscovery: string[] }> };
const loadManifest = async (): Promise<ManifestDocument> => JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../../config/capabilities.v1.json", import.meta.url), "utf8")) as ManifestDocument;
const bytes = (value: string) => new TextEncoder().encode(value);

async function disposableInstallation(): Promise<Readonly<{ root: string; agents: string; claude: string; cursor: string; manifest: ManifestDocument; files: DependencyFilesystem; cleanup(): Promise<void> }>> {
  const root = await mkdtemp(join(tmpdir(), "shipyard-dependency-install-"));
  const agents = join(root, "agents"), claude = join(root, "claude", "skills"), cursor = join(root, "cursor", "skills");
  const manifest = await loadManifest();
  const matt = manifest.dependencies.find(value => value.id === "matt-skills")!, ccpm = manifest.dependencies.find(value => value.id === "ccpm")!;
  await Promise.all([mkdir(join(agents, "skills"), { recursive: true }), mkdir(claude, { recursive: true }), mkdir(cursor, { recursive: true })]);
  const lock: Record<string, Record<string, string>> = {};
  for (const skill of matt.content.skills!) {
    const skillRoot = join(agents, "skills", skill.name);
    await mkdir(join(skillRoot, "agents"), { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), `---\nname: ${skill.name}\n---\nfixture ${skill.name}\n`);
    await writeFile(join(skillRoot, "agents", "openai.yaml"), "interface: fixture\n");
    skill.treeSha = (await observedTreeSha(nodeDependencyFilesystem, skillRoot))!;
    lock[skill.name] = { source: "mattpocock/skills", sourceType: "github", sourceUrl: "https://github.com/mattpocock/skills.git", ref: "2ab958093e83e0ec752e6c1c5932da465bf23e0c", skillPath: `${skill.sourcePath}/SKILL.md`, skillFolderHash: skill.treeSha };
    await symlink(skillRoot, join(claude, skill.name));
    await symlink(skillRoot, join(cursor, skill.name));
  }
  const ccpmRoot = join(agents, "skills", "ccpm");
  await mkdir(join(ccpmRoot, "references"), { recursive: true });
  await writeFile(join(ccpmRoot, "SKILL.md"), "---\nname: ccpm\n---\nfixture ccpm\n");
  await writeFile(join(ccpmRoot, "references", "runner.sh"), "#!/bin/sh\nexit 0\n");
  await chmod(join(ccpmRoot, "references", "runner.sh"), 0o755);
  await symlink(ccpmRoot, join(claude, "ccpm"));
  await symlink(ccpmRoot, join(cursor, "ccpm"));
  ccpm.content.treeSha = (await observedTreeSha(nodeDependencyFilesystem, ccpmRoot))!;
  lock.ccpm = { source: "visualjc/ccpm", sourceType: "github", sourceUrl: "https://github.com/visualjc/ccpm.git", ref: "cdb97474904ab2cdc7d391aa17393b444a28be3e", skillPath: "skill/ccpm/SKILL.md", skillFolderHash: ccpm.content.treeSha! };
  await writeFile(join(agents, ".skill-lock.json"), JSON.stringify({ version: 3, skills: lock }));
  return { root, agents, claude, cursor, manifest, files: nodeDependencyFilesystem, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function traced(files: DependencyFilesystem, calls: string[]): DependencyFilesystem {
  return {
    async lstat(path) { calls.push(`lstat:${path}`); return files.lstat(path); },
    async realpath(path) { calls.push(`realpath:${path}`); return files.realpath(path); },
    async readlink(path) { calls.push(`readlink:${path}`); return files.readlink(path); },
    async readFile(path, maximumBytes) { calls.push(`readFile:${path}`); return files.readFile(path, maximumBytes); },
    async readdir(path, maximumEntries) { calls.push(`readdir:${path}`); return files.readdir(path, maximumEntries); },
  };
}

test("runtime adapter permits only fixed version invocation and sanitizes failures", async () => {
  const calls: unknown[] = [];
  const adapter = new NodeDependencyRuntime(async (file, args, options) => { calls.push({ file, args, options }); return { code: 0, stdout: "codex 0.144.4\n" }; });
  assert.equal(await adapter.version("codex"), "0.144.4");
  assert.deepEqual(calls, [{ file: "codex", args: ["--version"], options: { timeoutMs: 3000, maximumOutputBytes: 4096 } }]);
  const unavailable = new NodeDependencyRuntime(async () => { throw new Error("token=secret / private/path"); });
  assert.equal(await unavailable.version("codex"), undefined);
});
test("bounded tree receipt matches Git for nested regular and executable files in a disposable tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-dependency-observer-"));
  await mkdir(join(root, "references"));
  await writeFile(join(root, "SKILL.md"), "---\nname: ccpm\n---\n");
  await writeFile(join(root, "references", "runner.sh"), "#!/bin/sh\necho bounded\n");
  await chmod(join(root, "references", "runner.sh"), 0o755);
  const observed = await observedTreeSha(nodeDependencyFilesystem, root);
  const execFile = promisify(execFileCallback);
  await execFile("git", ["init", "-q", root]);
  await execFile("git", ["-C", root, "add", "."]);
  const { stdout } = await execFile("git", ["-C", root, "write-tree"]);
  assert.equal(observed, stdout.trim());
});

test("filesystem adapter bounds hostile file and directory observations before decoding or materializing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-bounded-filesystem-"));
  try {
    const large = join(root, "large.bin");
    await writeFile(large, "x");
    // Sparse allocation keeps this test cheap while proving the opened-handle
    // size gate rejects before a whole file can be read into memory.
    await truncate(large, 1025);
    await assert.rejects(nodeDependencyFilesystem.readFile(large, 1024), /bounded limit/);
    await assert.rejects(nodeDependencyFilesystem.readFile(root, 1024), /observation failed/);

    const malformed = join(root, "malformed-skill");
    await mkdir(malformed);
    await writeFile(join(malformed, "SKILL.md"), Buffer.from([0xff, 0xfe]));
    assert.equal(await observedFrontmatterName(nodeDependencyFilesystem, malformed), undefined);

    const entries = join(root, "entries");
    await mkdir(entries);
    await Promise.all([writeFile(join(entries, "z"), "z"), writeFile(join(entries, "a"), "a"), writeFile(join(entries, "m"), "m")]);
    await assert.rejects(nodeDependencyFilesystem.readdir(entries, 2), /bounded limit/);
    assert.deepEqual((await nodeDependencyFilesystem.readdir(entries, 3))!.map(entry => entry.name), ["a", "m", "z"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a disposable v3 installation observes all 20 exact Matt receipts, CCPM, matching host links, and zero mutation calls", async () => {
  const fixture = await disposableInstallation();
  try {
    const calls: string[] = [], runtimeCalls: string[] = [];
    const runtime = new NodeDependencyRuntime(async (file, args) => { runtimeCalls.push(`${file}:${args.join(" ")}`); return { code: 0, stdout: "Codex CLI 0.144.4\n" }; });
    const observer = new LocalDependencyObserver(traced(fixture.files, calls), runtime, { agentsHome: fixture.agents, claudeSkillsHome: fixture.claude, cursorSkillsHome: fixture.cursor });
    const status = await new DependencyStatusService(observer, fixture.manifest).inspect({ host: "codex", lane: "large" });
    assert.equal(status.ready, true, JSON.stringify(status));
    assert.deepEqual(status.findings.map(value => value.state), ["ready", "ready", "ready"]);
    assert.equal(runtimeCalls.filter(value => value === "codex:--version").length, 3);
    assert.ok(calls.length > 100);
    assert.equal(calls.every(value => /^(lstat|realpath|readlink|readFile|readdir):/.test(value)), true);
  } finally { await fixture.cleanup(); }
});

test("observer distinguishes canonical matching host links from a separate physical duplicate", async () => {
  const fixture = await disposableInstallation();
  try {
    const runtime = new NodeDependencyRuntime(async () => ({ code: 0, stdout: "0.144.4" }));
    const observer = new LocalDependencyObserver(fixture.files, runtime, { agentsHome: fixture.agents, claudeSkillsHome: fixture.claude, cursorSkillsHome: fixture.cursor });
    assert.equal((await new DependencyStatusService(observer, fixture.manifest).inspect({ host: "codex", lane: "small" })).ready, true);
    const duplicate = join(fixture.root, "duplicate-wayfinder");
    await mkdir(join(duplicate, "agents"), { recursive: true });
    await writeFile(join(duplicate, "SKILL.md"), "---\nname: wayfinder\n---\nduplicate\n");
    await writeFile(join(duplicate, "agents", "openai.yaml"), "fixture\n");
    await rm(join(fixture.cursor, "wayfinder"));
    await symlink(duplicate, join(fixture.cursor, "wayfinder"));
    const status = await new DependencyStatusService(observer, fixture.manifest).inspect({ host: "codex", lane: "small" });
    assert.equal(status.ready, false);
    assert.equal(status.findings.find(value => value.dependency === "matt-skills")?.state, "duplicate");
  } finally { await fixture.cleanup(); }
});

test("observer distinguishes CCPM matching host links from a separate physical duplicate", async () => {
  const fixture = await disposableInstallation();
  try {
    const runtime = new NodeDependencyRuntime(async () => ({ code: 0, stdout: "0.144.4" }));
    const observer = new LocalDependencyObserver(fixture.files, runtime, { agentsHome: fixture.agents, claudeSkillsHome: fixture.claude, cursorSkillsHome: fixture.cursor });
    assert.equal((await new DependencyStatusService(observer, fixture.manifest).inspect({ host: "codex", lane: "large" })).findings.find(value => value.dependency === "ccpm")?.state, "ready");
    const duplicate = join(fixture.root, "duplicate-ccpm");
    await mkdir(join(duplicate, "references"), { recursive: true });
    await writeFile(join(duplicate, "SKILL.md"), "---\nname: ccpm\n---\nduplicate\n");
    await writeFile(join(duplicate, "references", "runner.sh"), "#!/bin/sh\nexit 0\n");
    await rm(join(fixture.cursor, "ccpm"));
    await symlink(duplicate, join(fixture.cursor, "ccpm"));
    const status = await new DependencyStatusService(observer, fixture.manifest).inspect({ host: "codex", lane: "large" });
    assert.equal(status.ready, false);
    assert.equal(status.findings.find(value => value.dependency === "ccpm")?.state, "duplicate");
  } finally { await fixture.cleanup(); }
});

test("missing, modified, malformed, and oversized disposable receipts fail closed without exposing fixture paths", async () => {
  const scenarios: Array<Readonly<{ name: string; alter(fixture: Awaited<ReturnType<typeof disposableInstallation>>): Promise<void>; state: string }>> = [
    { name: "missing content", async alter(fixture) { await rm(join(fixture.agents, "skills", "wayfinder"), { recursive: true }); }, state: "missing" },
    { name: "modified content", async alter(fixture) { await writeFile(join(fixture.agents, "skills", "wayfinder", "SKILL.md"), "---\nname: wayfinder\n---\nchanged\n"); }, state: "modified" },
    { name: "malformed receipt", async alter(fixture) { await writeFile(join(fixture.agents, ".skill-lock.json"), "{ no"); }, state: "missing" },
    { name: "oversized receipt", async alter(fixture) { await writeFile(join(fixture.agents, ".skill-lock.json"), "x".repeat(128 * 1024 + 1)); }, state: "missing" },
    { name: "duplicate receipt entry", async alter(fixture) { const lock = await readFile(join(fixture.agents, ".skill-lock.json"), "utf8"); await writeFile(join(fixture.agents, ".skill-lock.json"), lock.replace(/}}$/, ',"wayfinder":{"source":"attacker"}}}')); }, state: "missing" },
  ];
  for (const scenario of scenarios) {
    const fixture = await disposableInstallation();
    try {
      await scenario.alter(fixture);
      const observer = new LocalDependencyObserver(fixture.files, new NodeDependencyRuntime(async () => ({ code: 0, stdout: "0.144.4" })), { agentsHome: fixture.agents });
      const status = await new DependencyStatusService(observer, fixture.manifest).inspect({ host: "codex", lane: "small" });
      assert.equal(status.findings.find(value => value.dependency === "matt-skills")?.state, scenario.state, scenario.name);
      assert.equal(JSON.stringify(status).includes(fixture.root), false, scenario.name);
    } finally { await fixture.cleanup(); }
  }
});

test("observer rejects tree escapes, special entries, TOCTOU disappearance, bad frontmatter, and bounded directory/file violations", async () => {
  const fixture = await disposableInstallation();
  try {
    const root = join(fixture.agents, "skills", "wayfinder");
    await rm(join(root, "agents", "openai.yaml"));
    await symlink(fixture.root, join(root, "escape"));
    const observer = new LocalDependencyObserver(fixture.files, new NodeDependencyRuntime(async () => ({ code: 0, stdout: "0.144.4" })), { agentsHome: fixture.agents });
    const status = await new DependencyStatusService(observer, fixture.manifest).inspect({ host: "codex", lane: "small" });
    assert.equal(status.ready, false);
    assert.equal(status.findings.find(value => value.dependency === "matt-skills")?.state, "missing");
    assert.equal(JSON.stringify(status).includes(fixture.root), false);
    const disappearing: DependencyFilesystem = { ...fixture.files, async readFile(path, maximumBytes) { if (path.endsWith("wayfinder/SKILL.md")) return undefined; return fixture.files.readFile(path, maximumBytes); } };
    const disappeared = await new DependencyStatusService(new LocalDependencyObserver(disappearing, new NodeDependencyRuntime(async () => ({ code: 0, stdout: "0.144.4" })), { agentsHome: fixture.agents }), fixture.manifest).inspect({ host: "codex", lane: "small" });
    assert.equal(disappeared.ready, false);
  } finally { await fixture.cleanup(); }
});

test("runtime receipts are exact, newer versions are unverified, and deferred hosts never invoke a probe", async () => {
  const fixture = await disposableInstallation();
  try {
    let calls = 0;
    const newer = new LocalDependencyObserver(fixture.files, new NodeDependencyRuntime(async () => { calls++; return { code: 0, stdout: "0.144.5" }; }), { agentsHome: fixture.agents });
    const unverified = await new DependencyStatusService(newer, fixture.manifest).inspect({ host: "codex", lane: "large" });
    assert.equal(unverified.findings.some(value => value.state === "unverified"), true);
    calls = 0;
    const unsupported = await new DependencyStatusService(newer, fixture.manifest).inspect({ host: "cursor-pstack", lane: "large" });
    assert.deepEqual(unsupported.findings.map(value => value.state), ["incompatible"]);
    assert.equal(calls, 0);
  } finally { await fixture.cleanup(); }
});

test("hostile observer documents and unknown receipt data are converted to fixed redacted guidance", async () => {
  const manifest = await loadManifest();
  const hostile = new DependencyStatusService({ async inspect() { return new Proxy([], { get() { throw new Error("/secret/fixture token=bad"); } }) as never; } }, manifest);
  const status = await hostile.inspect({ host: "codex", lane: "small" });
  assert.deepEqual(status.findings.map(value => value.state), ["missing"]);
  assert.equal(JSON.stringify(status).match(/secret|fixture|token/), null);
  const unknown = structuredClone(manifest) as ManifestDocument;
  (unknown.dependencies[0] as unknown as Record<string, unknown>).unexpected = "no";
  await assert.rejects(new DependencyStatusService({ async inspect() { return []; } }, unknown).inspect({ host: "codex", lane: "small" }));
});
