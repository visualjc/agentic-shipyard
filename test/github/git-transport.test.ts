import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GitTransportService } from "../../src/github/git-transport.js";
import { GitTransportCommand, GitTransportCommandRunner, nodeGitTransportCommandRunner } from "../../src/adapters/git-transport.js";

class RecordingRunner implements GitTransportCommandRunner {
  readonly commands: GitTransportCommand[] = [];
  result = { exitCode: 0, stdout: "fetched", stderr: "" };
  async run(command: GitTransportCommand) {
    this.commands.push(command);
    return this.result;
  }
}

test("authenticated Git disables inherited credential helpers and keeps the token out of argv", async () => {
  const runner = new RecordingRunner();
  const transport = new GitTransportService(runner);
  const token = "github_pat_secret_transport_token";

  const result = await transport.run("/workspace/repository", ["fetch", "origin", "main"], { token });

  assert.equal(result.stdout, "fetched");
  assert.equal(runner.commands.length, 1);
  const [command] = runner.commands;
  assert.deepEqual(command.argv, ["-C", "/workspace/repository", "-c", "credential.helper=", "fetch", "origin", "main"]);
  assert.equal(command.env.GIT_CONFIG_COUNT, "1");
  assert.equal(command.env.GIT_CONFIG_KEY_0, "http.https://github.com/.extraheader");
  assert.equal(command.env.GIT_CONFIG_VALUE_0, `AUTHORIZATION: bearer ${token}`);
  assert.equal(command.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(command.argv.some((value) => value.includes(token)), false);
  assert.equal(command.argv.some((value) => value.includes("https://x-access-token:")), false);
});

test("the command contract does not invoke or mutate global gh state", async () => {
  const runner = new RecordingRunner();
  const transport = new GitTransportService(runner);
  await transport.run("/workspace/repository", ["ls-remote", "origin"], { token: "token" });
  assert.deepEqual(runner.commands.map((command) => command.executable), ["git"]);
});

test("transport refuses a token-bearing remote before the runner can observe it", async () => {
  const runner = new RecordingRunner();
  const transport = new GitTransportService(runner);
  await assert.rejects(
    transport.run("/workspace/repository", ["fetch", "https://x-access-token:token@github.com/acme/repository.git"], { token: "token" }),
    /refuses credentials/i,
  );
  assert.equal(runner.commands.length, 0);
});

test("production Git runner removes inherited Git and GitHub credential environment variables", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shipyard-git-env-"));
  const executable = join(directory, "git");
  const originalPath = process.env.PATH;
  const inherited = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_ASKPASS: process.env.GIT_ASKPASS,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
  };
  try {
    await writeFile(executable, "#!/bin/sh\nprintenv\n", { mode: 0o700 });
    await chmod(executable, 0o700);
    process.env.PATH = `${directory}:${originalPath ?? ""}`;
    process.env.GIT_CONFIG_GLOBAL = "inherited-git-config";
    process.env.GIT_ASKPASS = "inherited-askpass";
    process.env.GITHUB_TOKEN = "inherited-github-token";
    process.env.GH_TOKEN = "inherited-gh-token";

    const result = await nodeGitTransportCommandRunner.run({
      executable: "git",
      argv: [],
      env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "", GIT_TERMINAL_PROMPT: "0" },
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /GIT_CONFIG_COUNT=1/);
    assert.equal(result.stdout.includes("inherited-git-config"), false);
    assert.equal(result.stdout.includes("inherited-askpass"), false);
    assert.equal(result.stdout.includes("inherited-github-token"), false);
    assert.equal(result.stdout.includes("inherited-gh-token"), false);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    for (const [key, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
