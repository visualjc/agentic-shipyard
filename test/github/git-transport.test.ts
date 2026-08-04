import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GitTransportService } from "../../src/github/git-transport.js";
import { createNodeGitTransportCommandRunner, GitTransportCommand, GitTransportCommandRunner, nodeGitTransportCommandRunner } from "../../src/adapters/git-transport.js";

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
  assert.deepEqual(command.argv, ["-C", "/workspace/repository", "fetch", "origin", "main"]);
  assert.deepEqual(command.isolatedRemote, { repositoryPath: "/workspace/repository", remote: "origin" });
  assert.equal(command.env.GIT_CONFIG_COUNT, "2");
  assert.equal(command.env.GIT_CONFIG_KEY_0, "http.https://github.com/.extraheader");
  assert.equal(command.env.GIT_CONFIG_VALUE_0, "");
  assert.equal(command.env.GIT_CONFIG_KEY_1, "http.https://github.com/.extraheader");
  assert.equal(command.env.GIT_CONFIG_VALUE_1, `AUTHORIZATION: bearer ${token}`);
  assert.equal(command.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(command.argv.some((value) => value.includes(token)), false);
  assert.equal(command.argv.some((value) => value.includes("https://x-access-token:")), false);
});

test("the command contract does not invoke or mutate global gh state", async () => {
  const runner = new RecordingRunner();
  const transport = new GitTransportService(runner);
  await transport.run("/workspace/repository", ["ls-remote", "origin"], { token: "token" });
  assert.deepEqual(runner.commands.map((command) => command.executable), ["/usr/bin/git"]);
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

test("transport rejects option, config, helper, and exfiltration injection before the runner", async () => {
  const runner = new RecordingRunner();
  const transport = new GitTransportService(runner);
  for (const args of [
    ["fetch", "origin", "--upload-pack=evil"],
    ["-c", "credential.helper=evil", "fetch"],
    ["config", "--global", "alias.fetch=!curl"],
    ["fetch", "https://attacker.example/repository.git"],
    ["push", "origin", "main"],
  ]) {
    await assert.rejects(transport.run("/workspace/repository", args, { token: "token" }), /refuses|only permits/i);
  }
  assert.equal(runner.commands.length, 0);
});

test("production Git runner is PATH-independent and an explicitly injected executable receives only sanitized environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shipyard-git-env-"));
  const executable = join(directory, "trusted-git");
  const fakeGit = join(directory, "git");
  const fakeCapture = join(directory, "fake-capture");
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
    await writeFile(fakeGit, `#!/bin/sh\nprintf '%s' \"$GIT_CONFIG_VALUE_0\" > '${fakeCapture}'\n`, { mode: 0o700 });
    await chmod(fakeGit, 0o700);
    process.env.PATH = `${directory}:${originalPath ?? ""}`;
    process.env.GIT_CONFIG_GLOBAL = "inherited-git-config";
    process.env.GIT_ASKPASS = "inherited-askpass";
    process.env.GITHUB_TOKEN = "inherited-github-token";
    process.env.GH_TOKEN = "inherited-gh-token";

    const command = {
      executable: "/usr/bin/git",
      argv: ["--version"],
      env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "AUTHORIZATION: bearer ephemeral-token", GIT_TERMINAL_PROMPT: "0" },
    } as const;
    const result = await nodeGitTransportCommandRunner.run(command);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes("ephemeral-token"), false, "the default runner must not execute PATH's fake git");
    await assert.rejects(async () => await import("node:fs/promises").then(fs => fs.readFile(fakeCapture, "utf8")));

    const trustedRunner = createNodeGitTransportCommandRunner(executable);
    const trustedResult = await trustedRunner.run(command);
    assert.equal(trustedResult.exitCode, 0);
    assert.match(trustedResult.stdout, /GIT_CONFIG_COUNT=1/);
    assert.match(trustedResult.stdout, /AUTHORIZATION: bearer ephemeral-token/);
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

test("configured Git executable must be an absolute existing regular file", () => {
  assert.throws(() => createNodeGitTransportCommandRunner("git"), /absolute path/i);
  assert.throws(() => createNodeGitTransportCommandRunner("/definitely/not/git"), /existing regular file/i);
});

test("authenticated runner isolates a named remote from hostile Git config and developer-tool selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shipyard-isolated-git-"));
  const executable = join(directory, "trusted-git");
  const inherited = Object.fromEntries(["DEVELOPER_DIR", "SDKROOT", "TOOLCHAINS", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM"].map((key) => [key, process.env[key]]));
  try {
    await writeFile(executable, "#!/bin/sh\nif [ \"$3\" = config ]; then printf '%s\\n' 'https://github.com/acme/widget.git'; exit 0; fi\nprintf '%s\\n' '--CONFIG--'; cat \"$GIT_DIR/config\"; printf '%s\\n' '--ENV--'; printenv\n", { mode: 0o700 });
    await chmod(executable, 0o700);
    process.env.DEVELOPER_DIR = "/hostile/developer"; process.env.SDKROOT = "/hostile/sdk"; process.env.TOOLCHAINS = "hostile"; process.env.GIT_CONFIG_GLOBAL = "/hostile/config";
    const runner = createNodeGitTransportCommandRunner(executable);
    const result = await runner.run({
      executable, argv: ["-C", "/repository", "fetch", "origin", "main"],
      env: { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: "", GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_1: "AUTHORIZATION: bearer ephemeral-token" },
      isolatedRemote: { repositoryPath: "/repository", remote: "origin" },
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /url = https:\/\/github\.com\/acme\/widget\.git/);
    assert.equal(result.stdout.includes("hostile"), false);
    assert.equal(result.stdout.includes("GIT_CONFIG_GLOBAL=/hostile/config"), false);
    assert.match(result.stdout, /GIT_CONFIG_NOSYSTEM=1/);
    assert.match(result.stdout, /AUTHORIZATION: bearer ephemeral-token/);
  } finally {
    for (const [key, value] of Object.entries(inherited)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
  }
});
