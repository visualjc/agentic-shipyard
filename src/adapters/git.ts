import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { isAbsolute, resolve } from "node:path";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "./git-transport.js";

const execFileAsync = promisify(execFile);

export interface GitAdapter {
  commonDirectory(repositoryPath: string): Promise<string>;
  remoteUrl(repositoryPath: string, remoteName: string): Promise<string | undefined>;
}

async function git(repositoryPath: string, args: string[]): Promise<string | undefined> {
  try {
    // Resolve at operation time so package imports remain portable to hosts
    // without the platform-default Git installation. Never let child_process
    // select Git from PATH or let inherited Git/toolchain state select another
    // repository or executable.
    const { stdout } = await execFileAsync(canonicalGitExecutable(DEFAULT_NODE_GIT_EXECUTABLE), ["-C", repositoryPath, ...args], {
      encoding: "utf8",
      env: sanitizedGitEnvironment(),
    });
    return stdout.trim();
  } catch (error: unknown) {
    const code = (error as { code?: number }).code;
    if (code === 1 || code === 128) return undefined;
    throw error;
  }
}

/** Git identity is the canonical common git directory, never a worktree's .git file. */
export const nodeGit: GitAdapter = {
  async commonDirectory(repositoryPath) {
    const commonDirectory = await git(repositoryPath, ["rev-parse", "--git-common-dir"]);
    if (!commonDirectory) throw new Error(`Not a Git repository: ${repositoryPath}`);
    // macOS commonly exposes /var through the /private/var symlink. Canonicalize
    // both main clones and linked worktrees so the persisted key cannot diverge.
    return realpath(resolve(repositoryPath, isAbsolute(commonDirectory) ? commonDirectory : commonDirectory));
  },
  remoteUrl(repositoryPath, remoteName) {
    return git(repositoryPath, ["remote", "get-url", remoteName]);
  },
};
