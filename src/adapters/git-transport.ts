import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_NODE_GIT_EXECUTABLE = "/usr/bin/git";

function childEnvironment(command: GitTransportCommand): NodeJS.ProcessEnv {
  // Git's configuration and GitHub token environment variables can inject an
  // extra credential source/header. Keep ordinary process state (notably PATH)
  // while enforcing the command's complete Git/GitHub credential boundary.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT|GH|GITHUB)_/.test(key)));
  return { ...inherited, ...command.env };
}

/** A command runner is injected so transport policy is testable without GitHub or gh. */
export type GitTransportCommand = {
  /** Absolute Git executable; the Node runner pins and canonicalizes its configured value. */
  executable: string;
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

/**
 * Creates a runner pinned to one canonical, absolute Git executable. Supplying
 * a path is intentionally an explicit configuration/test seam: a bare command
 * name would be resolved through the inherited PATH after the token is added.
 */
export function createNodeGitTransportCommandRunner(executable = DEFAULT_NODE_GIT_EXECUTABLE): GitTransportCommandRunner {
  const trustedExecutable = canonicalGitExecutable(executable);
  return {
    async run(command) {
    try {
      const result = await execFileAsync(trustedExecutable, [...command.argv], {
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
}

/** Resolves a Git executable without permitting child_process PATH lookup. */
export function canonicalGitExecutable(executable = DEFAULT_NODE_GIT_EXECUTABLE): string {
  if (!isAbsolute(executable)) throw new Error("Git executable must be an absolute path.");
  let canonical: string;
  try {
    canonical = realpathSync(executable);
    if (!statSync(canonical).isFile()) throw new Error("not a regular file");
  } catch {
    throw new Error("Git executable must resolve to an existing regular file.");
  }
  return canonical;
}

/** Default production runner is pinned to the platform's trusted Git path. */
export const nodeGitTransportCommandRunner = createNodeGitTransportCommandRunner();
