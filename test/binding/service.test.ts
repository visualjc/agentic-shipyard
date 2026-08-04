import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { nodeGit } from "../../src/adapters/git.js";
import { BindingError } from "../../src/binding/errors.js";
import { ContractValidationError } from "../../src/contracts/validate.js";
import { BindingService, newBindingDocument, validateBindingDocument, validateTopology } from "../../src/binding/service.js";
import { JsonBindingStore } from "../../src/binding/store.js";
import { RepositoryBinding, RepositoryTopology } from "../../src/binding/types.js";
import { FakeGit, MemoryBindingStore, MemoryFilesystem } from "../helpers/fakes.js";

const execFile = promisify(execFileCallback);
const topology: Extract<RepositoryTopology, { kind: "staged-pair" }> = { kind: "staged-pair", development: { owner: "test", name: "development", remote: { name: "origin", url: "https://example.test/development.git" }, defaultBranch: "main" }, destination: { owner: "test", name: "destination", remote: { name: "destination", url: "https://example.test/destination.git" }, defaultBranch: "main" } };
const binding = (commonDirectory = "/git/main/.git"): RepositoryBinding => ({ schemaVersion: 1, profileName: "test", commonDirectory, topology, profileFingerprint: "0".repeat(64), boundAt: "2026-08-04T00:00:00.000Z" });

function configuredGit(): FakeGit {
  const git = new FakeGit();
  git.commonDirectories.set("/main", "/git/main/.git");
  git.commonDirectories.set("/linked", "/git/main/.git");
  for (const path of ["/main", "/linked"]) {
    git.remotes.set(`${path}:origin`, topology.development.remote.url);
    git.remotes.set(`${path}:destination`, topology.destination.remote.url);
  }
  return git;
}

test("rejects missing, duplicate, stale, partial, and remote-mismatched bindings", async () => {
  const cases: Array<[string, ReturnType<typeof newBindingDocument> | undefined, (git: FakeGit) => void, BindingError["code"]]> = [
    ["missing", undefined, () => {}, "repository-unbound"],
    ["duplicate", { schemaVersion: 1, bindings: [binding(), binding()] } as never, () => {}, "binding-store-invalid"],
    ["stale common directory", newBindingDocument([binding("/old/.git")]), () => {}, "repository-unbound"],
    ["remote mismatch", newBindingDocument([binding()]), (git) => git.remotes.set("/main:origin", "https://example.test/wrong.git"), "binding-remote-mismatch"],
  ];
  for (const [name, document, arrange, code] of cases) {
    const git = configuredGit(); arrange(git);
    const service = new BindingService(new MemoryBindingStore(document), git);
    await assert.rejects(service.resolve("/main"), (error: unknown) => error instanceof BindingError && error.code === code, name);
  }
});

test("bind validates the complete topology and requires explicit rebind", async () => {
  const git = configuredGit();
  const store = new MemoryBindingStore();
  const service = new BindingService(store, git);
  const candidate = { profileName: "test", topology, profileFingerprint: "0".repeat(64), boundAt: "2026-08-04T00:00:00.000Z" };
  await service.bind("/main", candidate);
  await assert.rejects(service.bind("/main", candidate), (error: unknown) => error instanceof BindingError && error.code === "binding-stale");
  await service.bind("/main", candidate, true);
  assert.throws(() => validateTopology({ kind: "staged-pair", development: topology.development, destination: topology.development }), (error: unknown) => error instanceof BindingError && error.code === "topology-invalid");
});

test("node Git adapter gives a linked worktree the main clone common-directory identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-binding-"));
  const main = join(root, "main");
  const linked = join(root, "linked");
  try {
    await run("git", ["init", main]);
    await run("git", ["-C", main, "config", "user.name", "Shipyard Test"]);
    await run("git", ["-C", main, "config", "user.email", "shipyard@example.test"]);
    await run("git", ["-C", main, "commit", "--allow-empty", "-m", "initial"]);
    await run("git", ["-C", main, "worktree", "add", "-b", "feature", linked]);
    assert.equal(await nodeGit.commonDirectory(main), await nodeGit.commonDirectory(linked));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("node Git adapter isolates binding authority from inherited Git state and PATH", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-binding-authority-"));
  const repository = join(root, "repository");
  const redirected = join(root, "redirected");
  const hostileBin = join(root, "hostile-bin");
  const pathGitWasRun = join(root, "path-git-was-run");
  const inheritedKeys = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "DEVELOPER_DIR", "SDKROOT", "TOOLCHAINS", "PATH"] as const;
  const inherited = Object.fromEntries(inheritedKeys.map((key) => [key, process.env[key]]));
  try {
    for (const path of [repository, redirected]) {
      await run("git", ["init", path]);
      await run("git", ["-C", path, "remote", "add", "origin", topology.development.remote.url]);
      await run("git", ["-C", path, "remote", "add", "destination", topology.destination.remote.url]);
    }
    await mkdir(hostileBin);
    await writeFile(join(hostileBin, "git"), `#!/bin/sh\ntouch '${pathGitWasRun}'\nexit 99\n`, { mode: 0o700 });
    process.env.GIT_DIR = join(redirected, ".git");
    process.env.GIT_WORK_TREE = redirected;
    process.env.GIT_INDEX_FILE = join(redirected, "index");
    process.env.GIT_OBJECT_DIRECTORY = join(redirected, ".git", "objects");
    process.env.GIT_CONFIG_GLOBAL = join(root, "hostile-global-config");
    process.env.GIT_CONFIG_SYSTEM = join(root, "hostile-system-config");
    process.env.GIT_CONFIG_NOSYSTEM = "0";
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "remote.origin.url";
    process.env.GIT_CONFIG_VALUE_0 = "https://example.test/redirected.git";
    process.env.DEVELOPER_DIR = join(root, "hostile-developer-tools");
    process.env.SDKROOT = join(root, "hostile-sdk");
    process.env.TOOLCHAINS = "hostile";
    process.env.PATH = hostileBin;

    const store = new MemoryBindingStore();
    const service = new BindingService(store, nodeGit);
    await service.bind(repository, { profileName: "test", topology, profileFingerprint: "0".repeat(64), boundAt: "2026-08-04T00:00:00.000Z" });
    const resolved = await service.resolve(repository);

    assert.equal(resolved.commonDirectory, await realpath(join(repository, ".git")));
    assert.notEqual(resolved.commonDirectory, await realpath(join(redirected, ".git")));
    assert.equal(await nodeGit.remoteUrl(repository, "origin"), topology.development.remote.url);
    assert.equal(existsSync(pathGitWasRun), false, "PATH-selected Git must never execute");
  } finally {
    for (const key of inheritedKeys) {
      const value = inherited[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("binding store deep-validates hostile persisted documents", async () => {
  const valid = binding();
  const hostile = [
    { schemaVersion: 1, bindings: [{ ...valid, profileName: "" }] },
    { schemaVersion: 1, bindings: [{ ...valid, boundAt: "not-a-date" }] },
    { schemaVersion: 1, bindings: [{ ...valid, surprise: true }] },
    { schemaVersion: 1, bindings: [{ ...valid, topology: { ...valid.topology, surprise: true } }] },
    { schemaVersion: 1, bindings: [{ ...valid, topology: { kind: "staged-pair", development: topology.development } }] },
    { schemaVersion: 1, bindings: [{ ...valid, topology: { ...topology, development: { ...topology.development, remote: { ...topology.development.remote, name: " " } } } }] },
    { schemaVersion: 1, bindings: [valid], surprise: true },
    { schemaVersion: 1, bindings: "not-an-array" },
    { schemaVersion: 1, bindings: [valid, { ...valid, profileName: "duplicate" }] },
  ];
  for (const candidate of hostile) {
    const fs = new MemoryFilesystem();
    fs.files.set("/bindings.json", JSON.stringify(candidate));
    await assert.rejects(new JsonBindingStore(fs, "/bindings.json").read(), (error: unknown) => error instanceof BindingError && error.code === "binding-store-invalid");
  }
});

test("duplicate common directories are rejected at the document boundary before git or store mutation", async () => {
  const duplicate = { schemaVersion: 1, bindings: [binding(), { ...binding(), profileName: "other" }] };
  assert.throws(() => validateBindingDocument(duplicate), (error: unknown) => error instanceof BindingError && error.code === "binding-store-invalid");
  const git = configuredGit();
  const hostile = new MemoryBindingStore(duplicate as never);
  await assert.rejects(new BindingService(hostile, git).resolve("/main"), (error: unknown) => error instanceof BindingError && error.code === "binding-store-invalid");
  const fs = new MemoryFilesystem();
  fs.files.set("/bindings.json", JSON.stringify(duplicate));
  await assert.rejects(new JsonBindingStore(fs, "/bindings.json").read(), (error: unknown) => error instanceof BindingError && error.code === "binding-store-invalid");
});

test("binding store validates writes as well as reads", async () => {
  const fs = new MemoryFilesystem();
  const store = new JsonBindingStore(fs, "/bindings.json");
  await assert.rejects(store.write({ schemaVersion: 1, bindings: [{ ...binding(), boundAt: "2026-02-30T00:00:00.000Z" }] }), (error: unknown) => error instanceof BindingError && error.code === "binding-store-invalid");
  assert.equal(fs.files.has("/bindings.json"), false);
});

test("BindingService distrusts a conforming-store implementation on reads and writes", async () => {
  const git = configuredGit();
  const hostile = new MemoryBindingStore({ schemaVersion: 1, bindings: [{ ...binding(), profileName: "" }] as never });
  const service = new BindingService(hostile, git);
  await assert.rejects(service.resolve("/main"), (error: unknown) => error instanceof BindingError && error.code === "binding-store-invalid");
  hostile.document = { schemaVersion: 1, bindings: [] };
  await assert.rejects(service.bind("/main", { profileName: "test", topology, profileFingerprint: "bad", boundAt: "not-a-date" } as never), (error: unknown) => error instanceof ContractValidationError && error.code === "invalid-binding");
  assert.equal(hostile.document.bindings.length, 0, "invalid candidate must never reach an alternate store");
});

async function run(command: string, args: string[]): Promise<void> { await execFile(command, args); }
