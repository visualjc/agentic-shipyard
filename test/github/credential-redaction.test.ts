import assert from "node:assert/strict";
import test from "node:test";
import { GitTransportError, GitTransportService, redactGitTransportDiagnostic } from "../../src/github/git-transport.js";
import { GitTransportCommand, GitTransportCommandRunner } from "../../src/adapters/git-transport.js";

class FailingRunner implements GitTransportCommandRunner {
  readonly commands: GitTransportCommand[] = [];
  async run(command: GitTransportCommand) {
    this.commands.push(command);
    return { exitCode: 128, stdout: "remote https://x-access-token:github_pat_example_secret@github.com/acme/private.git", stderr: "Authorization: bearer github_pat_example_secret" };
  }
}

test("failed authenticated Git diagnostics redact credential values from output and errors", async () => {
  const runner = new FailingRunner();
  const token = "github_pat_example_secret";
  const transport = new GitTransportService(runner);

  await assert.rejects(
    transport.run("/workspace/repository", ["fetch", "origin"], { token }),
    (error: unknown) => error instanceof GitTransportError
      && !error.message.includes(token)
      && !error.message.includes("x-access-token:")
      && error.message.includes("[REDACTED]"),
  );
  assert.equal(runner.commands[0].argv.some((argument) => argument.includes(token)), false);
});

test("redaction removes bearer tokens and URL user-info without changing safe diagnostics", () => {
  const diagnostic = "fatal: https://alice:secret@github.com/acme/repo; Authorization: Bearer abc.def-123";
  const redacted = redactGitTransportDiagnostic(diagnostic, ["secret"]);
  assert.equal(redacted.includes("secret"), false);
  assert.equal(redacted.includes("abc.def-123"), false);
  assert.match(redacted, /github\.com\/acme\/repo/);
  assert.match(redacted, /\[REDACTED\]/);
});

test("successful command output is also safe for callers to display", async () => {
  const token = "github_pat_success_secret";
  const runner: GitTransportCommandRunner = {
    async run() { return { exitCode: 0, stdout: `Authorization: bearer ${token}`, stderr: "" }; },
  };
  const result = await new GitTransportService(runner).run("/workspace/repository", ["fetch", "origin"], { token });
  assert.equal(result.stdout.includes(token), false);
  assert.match(result.stdout, /\[REDACTED\]/);
});
