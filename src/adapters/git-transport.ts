import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_NODE_GIT_EXECUTABLE = "/usr/bin/git";

/**
 * The complete environment for a production Git child. In particular, do not
 * inherit DEVELOPER_DIR/SDKROOT/TOOLCHAINS: on macOS `/usr/bin/git` is an
 * xcrun shim and those variables can select a different developer toolchain.
 * The fixed PATH is only for Git's own safe system helpers, never executable
 * selection by child_process (which receives an absolute Git path).
 */
export function sanitizedGitEnvironment(overrides: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin:/bin",
    LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    ...overrides,
  };
}

/** A command runner is injected so transport policy is testable without GitHub or gh. */
export type GitTransportCommand = {
  /** Absolute Git executable; the Node runner pins and canonicalizes its configured value. */
  executable: string;
  argv: readonly string[];
  /** Values exist only for this child process; callers must not persist or log them. */
  env: Readonly<Record<string, string>>;
  /** A named remote resolved into a temporary, config-isolated Git directory. */
  isolatedRemote?: Readonly<{ repositoryPath: string; remote: string }>;
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
    let isolatedGitDirectory: string | undefined;
    try {
      if (command.isolatedRemote) isolatedGitDirectory = await isolatedRemoteGitDirectory(trustedExecutable, command.isolatedRemote);
      const result = await execFileAsync(trustedExecutable, [...command.argv], {
        encoding: "utf8",
        env: sanitizedGitEnvironment({ ...command.env, ...(isolatedGitDirectory ? { GIT_DIR: isolatedGitDirectory } : {}) }),
      });
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error: unknown) {
      const result = error as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof result.code === "number" ? result.code : 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? result.message,
      };
    } finally { if (isolatedGitDirectory) await rm(isolatedGitDirectory, { recursive: true, force: true }); }
    },
  };
}

/**
 * Read only the named remote's raw local URL, without includes or credentials,
 * then run the network command against a temporary bare repository containing
 * exactly that remote. This prevents repository config from supplying helper,
 * proxy, extra-header, or url.*.insteadOf behavior to the authenticated child.
 */
async function isolatedRemoteGitDirectory(executable: string, remote: Readonly<{ repositoryPath: string; remote: string }>): Promise<string> {
  const { stdout } = await execFileAsync(executable, ["-C", remote.repositoryPath, "config", "--local", "--no-includes", "--get", `remote.${remote.remote}.url`], {
    encoding: "utf8", env: sanitizedGitEnvironment(),
  });
  const url = trustedGitHubRemoteUrl(stdout.trim());
  const directory = await mkdtemp(join(tmpdir(), "shipyard-git-remote-"));
  try {
    await writeFile(join(directory, "config"), `[core]\n\tbare = true\n[remote \"${remote.remote}\"]\n\turl = ${url}\n`, { encoding: "utf8", mode: 0o600 });
    return directory;
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

function trustedGitHubRemoteUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Authenticated Git requires a valid HTTPS github.com remote URL."); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url.pathname)) {
    throw new Error("Authenticated Git requires a credential-free HTTPS github.com repository remote URL.");
  }
  return url.toString();
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

/**
 * Convenient default that intentionally resolves Git only when a command is
 * run. Importing Shipyard is therefore safe on a host that does not provide
 * the platform default; the first Git operation reports that installation
 * problem instead.
 */
export const nodeGitTransportCommandRunner: GitTransportCommandRunner = {
  run(command) { return createNodeGitTransportCommandRunner().run(command); },
};
