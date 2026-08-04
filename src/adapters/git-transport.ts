import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function childEnvironment(command: GitTransportCommand): NodeJS.ProcessEnv {
  // Git's configuration and GitHub token environment variables can inject an
  // extra credential source/header. Keep ordinary process state (notably PATH)
  // while enforcing the command's complete Git/GitHub credential boundary.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT|GH|GITHUB)_/.test(key)));
  return { ...inherited, ...command.env };
}

/** A command runner is injected so transport policy is testable without GitHub or gh. */
export type GitTransportCommand = {
  executable: "git";
  argv: readonly string[];
  /** Values exist only for this child process; callers must not persist or log them. */
  env: Readonly<Record<string, string>>;
};

export type GitTransportCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export interface GitTransportCommandRunner {
  run(command: GitTransportCommand): Promise<GitTransportCommandResult>;
}

/** Node implementation deliberately executes only Git; it never uses or configures gh. */
export const nodeGitTransportCommandRunner: GitTransportCommandRunner = {
  async run(command) {
    try {
      const result = await execFileAsync(command.executable, [...command.argv], {
        encoding: "utf8",
        env: childEnvironment(command),
      });
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error: unknown) {
      const result = error as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof result.code === "number" ? result.code : 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? result.message,
      };
    }
  },
};
