import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "./git-transport.js";
import type { BaselineObservation, SyncGit } from "../sync/git.js";

const exec = promisify(execFile);
/** Local Git mutation adapter. It has no push/rebase/reset or merge-commit capability. */
export class NodeSyncGit implements SyncGit {
  private readonly executable: string;
  constructor(executable = DEFAULT_NODE_GIT_EXECUTABLE) { this.executable = canonicalGitExecutable(executable); }
  async observe(repo: string, remote: string, developmentBranch: string, destinationBranch: string): Promise<BaselineObservation> {
    const [dirty, branch, developmentSha, destinationSha, remoteUrl, format] = await Promise.all([
      this.required(repo, ["status", "--porcelain"]), this.required(repo, ["symbolic-ref", "--short", "HEAD"]),
      this.required(repo, ["rev-parse", `refs/heads/${developmentBranch}`]), this.required(repo, ["rev-parse", `refs/remotes/${remote}/${destinationBranch}`]),
      this.required(repo, ["remote", "get-url", remote]), this.required(repo, ["rev-parse", "--show-object-format"]),
    ]);
    const ancestry = developmentSha === destinationSha ? "equal" : await this.ancestor(repo, developmentSha, destinationSha) ? "behind" : await this.ancestor(repo, destinationSha, developmentSha) ? "ahead" : "diverged";
    const paths = (await this.required(repo, ["diff", "--name-only", developmentSha, destinationSha])).split("\n").filter(Boolean);
    if (format !== "sha1" && format !== "sha256") throw new Error("Unsupported Git object format.");
    return { clean: dirty === "", checkedOutBranch: branch, developmentSha, destinationSha, ancestry, remoteUrl: remoteUrl || undefined, changedPaths: paths, objectFormat: format };
  }
  async observeStaged(repo: string, staged: string, remote: string, developmentBranch: string): Promise<BaselineObservation> {
    const [dirty, branch, developmentSha, destinationSha, remoteUrl, format, stagedFormat] = await Promise.all([
      this.required(repo, ["status", "--porcelain"]), this.required(repo, ["symbolic-ref", "--short", "HEAD"]), this.required(repo, ["rev-parse", `refs/heads/${developmentBranch}`]),
      this.required(staged, ["rev-parse", "refs/shipyard/staged-destination"]), this.required(repo, ["remote", "get-url", remote]), this.required(repo, ["rev-parse", "--show-object-format"]), this.required(staged, ["rev-parse", "--show-object-format"]),
    ]);
    if (format !== stagedFormat || format !== "sha1" && format !== "sha256") throw new Error("Staged and product Git object formats differ.");
    const stagedDevelopment = await this.required(staged, ["rev-parse", "refs/shipyard/staged-development"]); if (stagedDevelopment !== developmentSha) throw new Error("Development main changed while staging destination facts.");
    const ancestry = developmentSha === destinationSha ? "equal" : await this.ancestor(staged, developmentSha, destinationSha) ? "behind" : await this.ancestor(staged, destinationSha, developmentSha) ? "ahead" : "diverged";
    const paths = (await this.required(staged, ["diff", "--name-only", developmentSha, destinationSha])).split("\n").filter(Boolean);
    return { clean: dirty === "", checkedOutBranch: branch, developmentSha, destinationSha, ancestry, remoteUrl, changedPaths: paths, objectFormat: format };
  }
  async fastForward(repo: string, _remote: string, branch: string, expected: string, destination: string): Promise<void> {
    if (!await this.ancestor(repo, expected, destination)) throw new Error("Fast-forward ancestry changed; no ref was updated.");
    if (await this.required(repo, ["symbolic-ref", "--short", "HEAD"]) !== branch) throw new Error("Checked-out branch changed; no ref was updated.");
    if (await this.required(repo, ["status", "--porcelain"]) !== "") throw new Error("Worktree or index changed; no ref was updated.");
    if (await this.required(repo, ["rev-parse", `refs/heads/${branch}`]) !== expected) throw new Error("Development branch changed; no ref was updated.");
    await this.required(repo, ["read-tree", "-u", "-m", expected, destination]);
    try { await this.required(repo, ["update-ref", `refs/heads/${branch}`, destination, expected]); }
    catch (error) { if (await this.required(repo, ["rev-parse", `refs/heads/${branch}`]) === expected) await this.required(repo, ["read-tree", "-u", "-m", destination, expected]); throw error; }
  }
  async importSource(repo: string, remote: string, source: string, local: string): Promise<string> { await this.required(repo, ["fetch", "--no-tags", remote, `${source}:${local}`]); return this.required(repo, ["rev-parse", local]); }
  async importStaged(repo: string, staged: string, stagedRef: string, localRef: string, expectedSha: string): Promise<string> {
    const temporary = `refs/shipyard/staged-import/${randomUUID()}`;
    await this.required(repo, ["fetch", "--no-tags", staged, `${stagedRef}:${temporary}`]);
    try {
      const resolved = await this.required(repo, ["rev-parse", temporary]); if (resolved !== expectedSha) throw new Error("Staged import did not resolve to its expected exact object.");
      const current = await this.optional(repo, localRef); if (localRef.startsWith("refs/shipyard/source/") && current !== undefined && current !== resolved) throw new Error("Existing source ref differs; policy-read-only source refs are never overwritten.");
      if (current !== resolved) await this.required(repo, ["update-ref", localRef, resolved, current ?? await this.nullObject(repo)]);
      return resolved;
    } finally { await this.required(repo, ["update-ref", "-d", temporary]); }
  }
  async resolveSource(repo: string, remote: string, source: string): Promise<string> {
    const value = await this.required(repo, ["ls-remote", remote, source]); const lines = value.split("\n").filter(Boolean); if (lines.length !== 1) throw new Error("Named source ref must resolve to exactly one destination ref."); const sha = lines[0]!.split(/\s+/)[0]; if (!sha) throw new Error("Named source ref did not resolve."); return sha;
  }
  resolveLocal(repo: string, localRef: string): Promise<string> { return this.required(repo, ["rev-parse", localRef]); }
  private async ancestor(repo: string, left: string, right: string): Promise<boolean> { try { await this.required(repo, ["merge-base", "--is-ancestor", left, right]); return true; } catch { return false; } }
  private async optional(repo: string, ref: string): Promise<string | undefined> { try { return await this.required(repo, ["rev-parse", "--verify", ref]); } catch { return undefined; } }
  private async nullObject(repo: string): Promise<string> { const format = await this.required(repo, ["rev-parse", "--show-object-format"]); return "0".repeat(format === "sha256" ? 64 : 40); }
  private async required(repo: string, args: string[]): Promise<string> { const { stdout } = await exec(this.executable, ["-C", repo, ...args], { encoding: "utf8", env: sanitizedGitEnvironment() }); return stdout.trim(); }
}
