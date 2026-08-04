import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { run } from "../../src/cli/main.js";
import { createDependencyStatus } from "../../src/cli/runtime.js";
import { setup } from "../../src/commands/setup.js";

test("dependency documentation separates the probe boundary from setup mutation and pins the reviewed planning host", async () => {
  const document = await readFile(join(process.cwd(), "docs", "dependencies.md"), "utf8");
  assert.match(document, /dependency-verification probe[\s\S]*never[\s\S]*acquires a mutation lock[\s\S]*invokes Git\/GitHub/i);
  assert.match(document, /limits describe the dependency probe, not every step of the surrounding\s+commands/i);
  assert.match(document, /shipyard-setup[\s\S]*Git common-directory identity[\s\S]*declared\s+remotes/i);
  assert.match(document, /setup acquires the governed\s+repository and binding-store mutation locks/i);
  assert.match(document, /status[\s\S]*only bounded `--version` probes[\s\S]*do\s+not run classification/i);
  assert.match(document, /exactly `codex-cli 0\.144\.4`[\s\S]*`gpt-5\.6-terra`[\s\S]*medium reasoning[\s\S]*read-only sandbox[\s\S]*ephemeral process/i);
  assert.match(document, /dedicated `CODEX_HOME`[\s\S]*normal Codex login flow[\s\S]*does not fall back to an ambient `CODEX_HOME`/i);
  assert.match(document, /missing or malformed file[\s\S]*wrong\s+version[\s\S]*blocks planning/i);

  const block = /```json\n([\s\S]*?)\n```/.exec(document);
  assert.ok(block, "planning host documentation must include its exact JSON shape");
  const example = JSON.parse(block[1]!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(example).sort(), ["codeHome", "executable", "runtimePath"]);
  assert.equal(JSON.stringify(example).match(/token|credential|account|model|prompt|argument/i), null);
});

test("dependency probing keeps real user discovery separate from SHIPYARD_HOME and turns absent or malformed hosts into data", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-runtime-boundary-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const shipyardHome = join(root, "shipyard-state"), userHome = join(root, "real-user");
  await Promise.all([
    mkdir(join(shipyardHome, ".agents", "skills"), { recursive: true }),
    mkdir(join(userHome, ".agents", "skills"), { recursive: true }),
    mkdir(join(userHome, ".claude", "skills"), { recursive: true }),
    mkdir(join(userHome, ".cursor", "skills"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(shipyardHome, ".agents", "sentinel"), "shipyard-only"),
    writeFile(join(userHome, ".agents", "sentinel"), "real-user-only"),
    writeFile(join(userHome, ".claude", "sentinel"), "real-user-only"),
    writeFile(join(userHome, ".cursor", "sentinel"), "real-user-only"),
  ]);
  const before = await Promise.all([
    readFile(join(shipyardHome, ".agents", "sentinel"), "utf8"),
    readFile(join(userHome, ".agents", "sentinel"), "utf8"),
    readFile(join(userHome, ".claude", "sentinel"), "utf8"),
    readFile(join(userHome, ".cursor", "sentinel"), "utf8"),
  ]);

  const observer = createDependencyStatus(shipyardHome, userHome);
  const missing = await observer.inspect({ host: "codex", lane: "small" });
  assert.equal(missing.findings.find(finding => finding.dependency === "planning-host")?.state, "missing");
  assert.equal(missing.findings.find(finding => finding.dependency === "matt-skills")?.state, "missing", "a Shipyard-state .agents directory must never masquerade as the user's installed skills");
  await writeFile(join(shipyardHome, "planning-host.json"), "{ malformed");
  const malformed = await observer.inspect({ host: "codex", lane: "small" });
  assert.equal(malformed.findings.find(finding => finding.dependency === "planning-host")?.state, "incompatible");
  assert.equal(malformed.ready, false);
  assert.deepEqual(await Promise.all([
    readFile(join(shipyardHome, ".agents", "sentinel"), "utf8"),
    readFile(join(userHome, ".agents", "sentinel"), "utf8"),
    readFile(join(userHome, ".claude", "sentinel"), "utf8"),
    readFile(join(userHome, ".cursor", "sentinel"), "utf8"),
  ]), before, "status/setup probing is observational: it must not create, relink, or rewrite any discovery tree");
  await assert.rejects(access(join(shipyardHome, "bindings.json")));
});

test("help is deterministic and does not load a malformed planning host", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "shipyard-help-boundary-"));
  t.after(async () => { await rm(home, { recursive: true, force: true }); });
  await writeFile(join(home, "planning-host.json"), "{ malformed");
  const result = await run(["--home", home], "help", home);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /shipyard <request>/);
  assert.equal(await readFile(join(home, "planning-host.json"), "utf8"), "{ malformed");
  await assert.rejects(access(join(home, "bindings.json")));
  await assert.rejects(access(join(home, "locks")));
});

test("setup dependency gate occurs before every mutation lock and binding write", async () => {
  let binds = 0, lockAcquires = 0;
  const profile = {
    schemaVersion: 1 as const,
    name: "bound",
    actor: { login: "visualjc" },
    topology: { kind: "single-repository" as const, repository: { owner: "visualjc", name: "shipyard", remote: { name: "origin", url: "https://github.com/visualjc/shipyard.git" }, defaultBranch: "main" } },
    allowedOperations: ["setup"] as const,
    pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }] },
  };
  await assert.rejects(
    setup({
      bindings: { async bind() { binds += 1; throw new Error("must not bind"); } } as any,
      git: { async commonDirectory() { return "/repo/.git"; } } as any,
      locks: { async acquire() { lockAcquires += 1; throw new Error("must not lock"); } } as any,
      profiles: { async read() { return profile; } },
      setupLockPath: () => "/repo/planning.lock",
      bindingMutationLockPath: () => "/shipyard/binding-store.lock",
      dependencyStatus: { async inspect() { return { schemaVersion: 1 as const, findings: [{ dependency: "planning-host" as const, state: "missing" as const, remediation: "configure" }], ready: false, nextSafeAction: "shipyard-setup" }; } },
    }, { repositoryPath: "/repo", profile: "bound", topology: { kind: "single-repository", development: { name: "origin", url: "https://github.com/visualjc/shipyard.git" } }, rebind: false }),
    /dependencies are not ready/i,
  );
  assert.equal(binds, 0);
  assert.equal(lockAcquires, 0, "a missing host/dependency cannot acquire either setup/binding or planning mutation locks");
});
