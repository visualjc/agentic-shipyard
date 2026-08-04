import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { nodeGit } from "../../src/adapters/git.js";
import { BindingError } from "../../src/binding/errors.js";
import { BindingService, newBindingDocument, validateTopology } from "../../src/binding/service.js";
import { JsonBindingStore } from "../../src/binding/store.js";
import { RepositoryBinding, RepositoryTopology } from "../../src/binding/types.js";
import { FakeGit, MemoryBindingStore, MemoryFilesystem } from "../helpers/fakes.js";

const execFile = promisify(execFileCallback);
const topology: RepositoryTopology = { kind: "staged-pair", development: { name: "origin", url: "https://example.test/development.git" }, destination: { name: "destination", url: "https://example.test/destination.git" } };
const binding = (commonDirectory = "/git/main/.git"): RepositoryBinding => ({ version: 1, profile: "test", commonDirectory, topology, createdAt: "2026-08-04T00:00:00.000Z" });

function configuredGit(): FakeGit {
  const git = new FakeGit();
  git.commonDirectories.set("/main", "/git/main/.git");
  git.commonDirectories.set("/linked", "/git/main/.git");
  for (const path of ["/main", "/linked"]) {
    git.remotes.set(`${path}:origin`, topology.development.url);
    git.remotes.set(`${path}:destination`, topology.destination!.url);
  }
  return git;
}

test("rejects missing, duplicate, stale, partial, and remote-mismatched bindings", async () => {
  const cases: Array<[string, ReturnType<typeof newBindingDocument> | undefined, (git: FakeGit) => void, BindingError["code"]]> = [
    ["missing", undefined, () => {}, "repository-unbound"],
    ["duplicate", newBindingDocument([binding(), binding()]), () => {}, "binding-duplicate"],
    ["stale common directory", newBindingDocument([binding("/old/.git")]), () => {}, "repository-unbound"],
    ["partial topology", newBindingDocument([{ ...binding(), topology: { kind: "staged-pair", development: topology.development } }]), () => {}, "topology-incomplete"],
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
  const candidate = { profile: "test", topology, createdAt: "2026-08-04T00:00:00.000Z" };
  await service.bind("/main", candidate);
  await assert.rejects(service.bind("/main", candidate), (error: unknown) => error instanceof BindingError && error.code === "binding-stale");
  await service.bind("/main", candidate, true);
  assert.throws(() => validateTopology({ kind: "single-repository", development: topology.development, destination: topology.destination }), (error: unknown) => error instanceof BindingError && error.code === "topology-invalid");
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

test("binding store deep-validates hostile persisted documents", async () => {
  const valid = binding();
  const hostile = [
    { version: 1, bindings: [{ ...valid, profile: "" }] },
    { version: 1, bindings: [{ ...valid, createdAt: "not-a-date" }] },
    { version: 1, bindings: [{ ...valid, surprise: true }] },
    { version: 1, bindings: [{ ...valid, topology: { ...valid.topology, surprise: true } }] },
    { version: 1, bindings: [{ ...valid, topology: { kind: "staged-pair", development: valid.topology.development } }] },
    { version: 1, bindings: [{ ...valid, topology: { ...valid.topology, development: { ...valid.topology.development, name: " " } } }] },
    { version: 1, bindings: [valid], surprise: true },
    { version: 1, bindings: "not-an-array" },
  ];
  for (const candidate of hostile) {
    const fs = new MemoryFilesystem();
    fs.files.set("/bindings.json", JSON.stringify(candidate));
    await assert.rejects(new JsonBindingStore(fs, "/bindings.json").read(), (error: unknown) => error instanceof BindingError && error.code === "binding-store-invalid");
  }
});

test("binding store validates writes as well as reads", async () => {
  const fs = new MemoryFilesystem();
  const store = new JsonBindingStore(fs, "/bindings.json");
  await assert.rejects(store.write({ version: 1, bindings: [{ ...binding(), createdAt: "2026-02-30T00:00:00.000Z" }] }), (error: unknown) => error instanceof BindingError && error.code === "binding-store-invalid");
  assert.equal(fs.files.has("/bindings.json"), false);
});

async function run(command: string, args: string[]): Promise<void> { await execFile(command, args); }
