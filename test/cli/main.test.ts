import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { run } from "../../src/cli/main.js";

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
    const incomplete = await run(["--home", fixture.home, "--profile", "x", "--topology", "staged-pair", "--development-name", "origin", "--development-url", fixture.origin], "setup", fixture.main);
    assert.equal(incomplete.code, 1);
    assert.match(incomplete.output, /topology is incomplete/i);
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

async function createRepository() {
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
  return { main, home, linked, origin, destination, dispose: () => rm(root, { recursive: true, force: true }) };
}
