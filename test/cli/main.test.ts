import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { run } from "../../src/cli/main.js";
import { createRuntime } from "../../src/cli/runtime.js";

const execFile = promisify(execFileCallback);

test("setup validates existing remotes, requires rebind, and status/help are read-only", async () => {
  const fixture = await createRepository();
  try {
    const setupArgs = ["--home", fixture.home, "--profile", "demo", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin, "--destination-name", "destination", "--destination-url", fixture.destination];
    const first = await run(setupArgs, "setup", fixture.main);
    assert.equal(first.code, 0);
    const bindingPath = join(fixture.home, "bindings.json");
    const before = await readFile(bindingPath, "utf8");
    const duplicate = await run(setupArgs, "setup", fixture.main);
    assert.equal(duplicate.code, 1);
    assert.match(duplicate.output, /--rebind/);
    const status = await run(["--home", fixture.home], "status", fixture.main);
    assert.equal(status.code, 0);
    assert.match(status.output, /"phase": "ready"/);
    assert.equal(await readFile(bindingPath, "utf8"), before, "status must not write binding state");
    const help = await run(["setup"], "help", fixture.main);
    assert.equal(help.code, 0);
    assert.match(help.output, /shipyard-setup/);
    assert.equal(await readFile(bindingPath, "utf8"), before, "help must not write binding state");
  } finally { await fixture.dispose(); }
});

test("remote mismatch and incomplete topology return deterministic corrective guidance", async () => {
  const fixture = await createRepository();
  try {
    const setupArgs = ["--home", fixture.home, "--profile", "demo", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin, "--destination-name", "destination", "--destination-url", fixture.destination];
    assert.equal((await run(setupArgs, "setup", fixture.main)).code, 0);
    await execFile("git", ["-C", fixture.main, "remote", "set-url", "origin", "https://example.test/changed.git"]);
    const mismatch = await run(["--home", fixture.home], "status", fixture.main);
    assert.equal(mismatch.code, 1);
    assert.match(mismatch.output, /will not rewrite remotes/);
    const incomplete = await run(["--home", fixture.home, "--profile", "demo", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin], "setup", fixture.main);
    assert.equal(incomplete.code, 1);
    assert.match(incomplete.output, /does not match the named global profile/i);
  } finally { await fixture.dispose(); }
});

test("a linked worktree resolves the binding stored for its main clone", async () => {
  const fixture = await createRepository();
  try {
    await execFile("git", ["-C", fixture.main, "worktree", "add", "-b", "feature", fixture.linked]);
    const setupArgs = ["--home", fixture.home, "--profile", "demo", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin, "--destination-name", "destination", "--destination-url", fixture.destination];
    assert.equal((await run(setupArgs, "setup", fixture.main)).code, 0);
    const result = await run(["--home", fixture.home], "status", fixture.linked);
    assert.equal(result.code, 0);
    assert.match(result.output, /"profile": "demo"/);
  } finally { await fixture.dispose(); }
});

test("setup requires a valid named global profile whose identity matches the request", async () => {
  const fixture = await createRepository(false);
  try {
    const arguments_ = ["--home", fixture.home, "--profile", "demo", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin, "--destination-name", "destination", "--destination-url", fixture.destination];
    const missing = await run(arguments_, "setup", fixture.main);
    assert.equal(missing.code, 1);
    assert.match(missing.output, /global profile is missing/);
    await assert.rejects(access(join(fixture.home, "bindings.json")));

    await writeProfile(fixture, "demo", { malformed: true });
    const malformed = await run(arguments_, "setup", fixture.main);
    assert.equal(malformed.code, 1);
    assert.match(malformed.output, /profile is malformed/);
    await assert.rejects(access(join(fixture.home, "bindings.json")));

    await writeProfile(fixture, "other", { declaredName: "different" });
    const nameMismatch = await run(arguments_.map((value) => value === "demo" ? "other" : value), "setup", fixture.main);
    assert.equal(nameMismatch.code, 1);
    assert.match(nameMismatch.output, /file and its declared name differ/);

    await writeProfile(fixture, "demo", { destinationUrl: "https://example.test/not-the-destination.git" });
    const topologyMismatch = await run(arguments_, "setup", fixture.main);
    assert.equal(topologyMismatch.code, 1);
    assert.match(topologyMismatch.output, /topology does not match/);
    await assert.rejects(access(join(fixture.home, "bindings.json")));
  } finally { await fixture.dispose(); }
});

test("single-repository setup derives the development binding identity from its profile", async () => {
  const fixture = await createRepository(false);
  try {
    await writeSingleRepositoryProfile(fixture, "single");
    const result = await run(["--home", fixture.home, "--profile", "single", "--topology", "single-repository", "--development-name", "origin", "--development-url", fixture.origin], "setup", fixture.main);
    assert.equal(result.code, 0);
    const binding = JSON.parse(await readFile(join(fixture.home, "bindings.json"), "utf8"));
    assert.equal(binding.bindings[0].topology.kind, "single-repository");
    assert.deepEqual(binding.bindings[0].topology.repository.remote, { name: "origin", url: fixture.origin });
  } finally { await fixture.dispose(); }
});

test("a concurrent setup lock prevents a rebind writer from overwriting binding identity", async () => {
  const fixture = await createRepository();
  try {
    await writeProfile(fixture, "alternate");
    const setupArgs = ["--home", fixture.home, "--profile", "demo", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin, "--destination-name", "destination", "--destination-url", fixture.destination];
    assert.equal((await run(setupArgs, "setup", fixture.main)).code, 0);
    const bindingPath = join(fixture.home, "bindings.json");
    const before = await readFile(bindingPath, "utf8");
    const runtime = createRuntime(fixture.home);
    const commonDirectory = await runtime.git.commonDirectory(fixture.main);
    const held = await runtime.locks.acquire(runtime.setupLockPath(commonDirectory), commonDirectory, "setup");
    try {
      const attempt = await run(setupArgs.map((value) => value === "demo" ? "alternate" : value).concat("--rebind"), "setup", fixture.main);
      assert.equal(attempt.code, 1);
      assert.match(attempt.output, /blocked by another repository mutation/);
      assert.equal(await readFile(bindingPath, "utf8"), before);
    } finally { await held.release(); }
  } finally { await fixture.dispose(); }
});

test("concurrent setup for different repositories retains both canonical bindings", async () => {
  const first = await createRepository();
  const second = await createRepository(false);
  try {
    second.home = first.home;
    await writeProfile(second, "other");
    const args = (fixture: typeof first, profile: string) => ["--home", first.home, "--profile", profile, "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin, "--destination-name", "destination", "--destination-url", fixture.destination];
    const [a, b] = await Promise.all([run(args(first, "demo"), "setup", first.main), run(args(second, "other"), "setup", second.main)]);
    assert.equal([a, b].filter((result) => result.code === 0).length, 1, "one owner may proceed while the shared binding-store lock is held");
    const blocked = a.code === 1 ? { fixture: first, profile: "demo", result: a } : { fixture: second, profile: "other", result: b };
    assert.match(blocked.result.output, /blocked by another repository mutation/);
    const retry = await run(args(blocked.fixture, blocked.profile), "setup", blocked.fixture.main);
    assert.equal(retry.code, 0, retry.output);
    const document = JSON.parse(await readFile(join(first.home, "bindings.json"), "utf8"));
    assert.equal(document.schemaVersion, 1);
    assert.equal(document.bindings.length, 2, "a successful cross-repository setup must never lose another binding");
    assert.deepEqual(document.bindings.map((binding: { profileName: string }) => binding.profileName).sort(), ["demo", "other"]);
  } finally { await first.dispose(); await second.dispose(); }
});

test("status revalidates the named profile, topology, and status authorization without locks", async () => {
  const fixture = await createRepository();
  try {
    const setupArgs = ["--home", fixture.home, "--profile", "demo", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin, "--destination-name", "destination", "--destination-url", fixture.destination];
    assert.equal((await run(setupArgs, "setup", fixture.main)).code, 0);
    await rm(join(fixture.home, "profiles", "demo.json"));
    const missing = await run(["--home", fixture.home], "status", fixture.main);
    assert.equal(missing.code, 1); assert.match(missing.output, /global profile is missing/);
    await writeProfile(fixture, "demo", { destinationUrl: "https://example.test/changed-profile.git" });
    const changed = await run(["--home", fixture.home], "status", fixture.main);
    assert.equal(changed.code, 1); assert.match(changed.output, /--rebind/);
    const denied = { schemaVersion: 1, name: "demo", actor: { login: "shipyard-test" }, topology: { kind: "staged-pair", development: { owner: "test", name: "development", remote: { name: "origin", url: fixture.origin }, defaultBranch: "main" }, destination: { owner: "test", name: "destination", remote: { name: "destination", url: fixture.destination }, defaultBranch: "main" } }, allowedOperations: ["setup"], pathPolicy: policy() };
    await writeFile(join(fixture.home, "profiles", "demo.json"), JSON.stringify(denied));
    const unauthorized = await run(["--home", fixture.home], "status", fixture.main);
    assert.equal(unauthorized.code, 1); assert.match(unauthorized.output, /does not authorize/);
  } finally { await fixture.dispose(); }
});

test("status refuses actor-only and path-policy-only profile authority drift until rebind", async () => {
  const fixture = await createRepository();
  try {
    const args = ["--home", fixture.home, "--profile", "demo", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin, "--destination-name", "destination", "--destination-url", fixture.destination];
    assert.equal((await run(args, "setup", fixture.main)).code, 0);
    await writeProfile(fixture, "demo", { actor: "changed-actor" });
    const actor = await run(["--home", fixture.home], "status", fixture.main);
    assert.equal(actor.code, 1); assert.match(actor.output, /authority has changed.*--rebind/i);
    assert.equal((await run([...args, "--rebind"], "setup", fixture.main)).code, 0);
    await writeProfile(fixture, "demo", { pathPolicy: { schemaVersion: 1, rules: [{ owner: "scratch", pattern: "src/**" }] } });
    const policyDrift = await run(["--home", fixture.home], "status", fixture.main);
    assert.equal(policyDrift.code, 1); assert.match(policyDrift.output, /authority has changed.*--rebind/i);
  } finally { await fixture.dispose(); }
});

test("setup refuses unsafe stale-lock recovery with actionable owner guidance", async () => {
  const fixture = await createRepository();
  try {
    const runtime = createRuntime(fixture.home);
    const commonDirectory = await runtime.git.commonDirectory(fixture.main);
    const lockPath = runtime.setupLockPath(commonDirectory);
    await mkdir(join(fixture.home, "locks"), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ version: 1, repository: commonDirectory, operation: "setup", processId: 987654, host: "another-host", token: "stale-cross-host-owner", acquiredAt: "2000-01-01T00:00:00.000Z" }));
    const setupArgs = ["--home", fixture.home, "--profile", "demo", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin, "--destination-name", "destination", "--destination-url", fixture.destination];
    const result = await run(setupArgs, "setup", fixture.main);
    assert.equal(result.code, 1);
    assert.match(result.output, /cannot be recovered safely/);
    await assert.rejects(access(join(fixture.home, "bindings.json")));
  } finally { await fixture.dispose(); }
});

test("non-Git setup and status return actionable repository identity guidance", async () => {
  const fixture = await createRepository();
  try {
    const notRepository = join(fixture.root, "not-a-repository");
    await mkdir(notRepository);
    const setupArgs = ["--home", fixture.home, "--profile", "demo", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin, "--destination-name", "destination", "--destination-url", fixture.destination, "--repo", notRepository];
    const setupResult = await run(setupArgs, "setup", fixture.main);
    assert.equal(setupResult.code, 1);
    assert.match(setupResult.output, /existing Git repository/);
    const statusResult = await run(["--home", fixture.home, "--repo", notRepository], "status", fixture.main);
    assert.equal(statusResult.code, 1);
    assert.match(statusResult.output, /existing Git repository/);
  } finally { await fixture.dispose(); }
});

async function createRepository(withProfile = true) {
  const root = await mkdtemp(join(tmpdir(), "shipyard-cli-"));
  const main = join(root, "main");
  const home = join(root, "home");
  const linked = join(root, "linked");
  const origin = "https://example.test/development.git";
  const destination = "https://example.test/destination.git";
  await execFile("git", ["init", main]);
  await execFile("git", ["-C", main, "config", "user.name", "Shipyard Test"]);
  await execFile("git", ["-C", main, "config", "user.email", "shipyard@example.test"]);
  await execFile("git", ["-C", main, "commit", "--allow-empty", "-m", "initial"]);
  await execFile("git", ["-C", main, "remote", "add", "origin", origin]);
  await execFile("git", ["-C", main, "remote", "add", "destination", destination]);
  const fixture = { root, main, home, linked, origin, destination, dispose: () => rm(root, { recursive: true, force: true }) };
  if (withProfile) await writeProfile(fixture, "demo");
  return fixture;
}

async function writeProfile(
  fixture: { home: string; origin: string; destination: string },
  fileName: string,
  options: { malformed?: boolean; declaredName?: string; destinationUrl?: string; actor?: string; pathPolicy?: ReturnType<typeof policy> } = {},
): Promise<void> {
  const directory = join(fixture.home, "profiles");
  await mkdir(directory, { recursive: true });
  const document: unknown = options.malformed ? { schemaVersion: 99 } : {
    schemaVersion: 1,
    name: options.declaredName ?? fileName,
    actor: { login: options.actor ?? "shipyard-test" },
    topology: {
      kind: "staged-pair",
      development: { owner: "test", name: "development", remote: { name: "origin", url: fixture.origin }, defaultBranch: "main" },
      destination: { owner: "test", name: "destination", remote: { name: "destination", url: options.destinationUrl ?? fixture.destination }, defaultBranch: "main" },
    },
    allowedOperations: ["setup", "status", "help"],
    pathPolicy: options.pathPolicy ?? policy(),
  };
  await writeFile(join(directory, `${fileName}.json`), `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
}

async function writeSingleRepositoryProfile(
  fixture: { home: string; origin: string },
  fileName: string,
): Promise<void> {
  const directory = join(fixture.home, "profiles");
  await mkdir(directory, { recursive: true });
  const document = {
    schemaVersion: 1,
    name: fileName,
    actor: { login: "shipyard-test" },
    topology: {
      kind: "single-repository",
      repository: { owner: "test", name: "product", remote: { name: "origin", url: fixture.origin }, defaultBranch: "main" },
    },
    allowedOperations: ["setup", "status", "help"],
    pathPolicy: policy(),
  };
  await writeFile(join(directory, `${fileName}.json`), `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
}

function policy() { return { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] }; }
