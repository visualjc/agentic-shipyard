import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_GIT_COMMAND_MAX_OUTPUT_BYTES, DEFAULT_GIT_COMMAND_TIMEOUT_MS, DEFAULT_NODE_GIT_EXECUTABLE, canonicalGitExecutable, sanitizedGitEnvironment } from "./git-transport.js";
import { SingleRepositoryError } from "../single-repository/errors.js";
import type { SingleRepositoryProductAuthority, SingleRepositoryProductObservation } from "../single-repository/types.js";

const execute = promisify(execFile), MAX_TREE_ENTRIES = 100_000;

/** Read-only, exact checked-out-product observation. It never reads a remote or credential. */
export class NodeSingleRepositoryProductAuthority implements SingleRepositoryProductAuthority {
  private readonly executable: string;
  constructor(executable = DEFAULT_NODE_GIT_EXECUTABLE) { this.executable = canonicalGitExecutable(executable); }

  async observe(request: Readonly<{ repositoryPath: string; branch: string; expectedHeadSha: string; expectedBaseSha: string }>): Promise<SingleRepositoryProductObservation> {
    if (!request.repositoryPath.trim() || !safeBranch(request.branch) || !fullSha(request.expectedHeadSha) || !fullSha(request.expectedBaseSha)) throw changed();
    // Establish a clean checked-out identity before reading any pinned object.  The
    // object reads below deliberately never name HEAD: a concurrent checkout must
    // fail the final identity check rather than produce a mixed observation.
    const dirty = await this.text(request.repositoryPath, ["status", "--porcelain"]);
    const branch = await this.text(request.repositoryPath, ["symbolic-ref", "--short", "HEAD"]);
    const headSha = await this.text(request.repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const branchSha = await this.text(request.repositoryPath, ["rev-parse", "--verify", `refs/heads/${request.branch}^{commit}`]);
    const baseSha = await this.text(request.repositoryPath, ["rev-parse", "--verify", `${request.expectedBaseSha}^{commit}`]);
    const objectFormat = await this.text(request.repositoryPath, ["rev-parse", "--show-object-format"]);
    if (dirty !== "" || branch !== request.branch || headSha !== request.expectedHeadSha || branchSha !== headSha || baseSha !== request.expectedBaseSha || (objectFormat !== "sha1" && objectFormat !== "sha256")) throw changed();
    const headTreeSha = await this.text(request.repositoryPath, ["rev-parse", "--verify", `${request.expectedHeadSha}^{tree}`]);
    const raw = await this.bytes(request.repositoryPath, ["ls-tree", "-r", "-z", request.expectedHeadSha]), records = splitZero(raw);
    if (records.length > MAX_TREE_ENTRIES) throw new SingleRepositoryError("path-policy", "Single-repository tree exceeds its certification entry budget.");
    const length = objectFormat === "sha1" ? 40 : 64, entries = records.map((record) => {
      const tab = record.indexOf(0x09); if (tab <= 0 || tab === record.length - 1) throw invalidTree();
      const match = /^(100644|100755|120000|160000) (?:blob|commit) ([a-f0-9]+)$/.exec(record.subarray(0, tab).toString("ascii")), pathBytes = record.subarray(tab + 1), path = pathBytes.toString("utf8");
      if (!match || match[2]!.length !== length || !Buffer.from(path, "utf8").equals(pathBytes)) throw invalidTree();
      return Object.freeze({ path, mode: match[1] as "100644" | "100755" | "120000" | "160000", objectId: match[2]! });
    }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const touchedPaths = await this.touchedPaths(request.repositoryPath, request.expectedBaseSha, request.expectedHeadSha);
    const finalDirty = await this.text(request.repositoryPath, ["status", "--porcelain"]);
    const finalBranch = await this.text(request.repositoryPath, ["symbolic-ref", "--short", "HEAD"]);
    const finalHead = await this.text(request.repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const finalBranchSha = await this.text(request.repositoryPath, ["rev-parse", "--verify", `refs/heads/${request.branch}^{commit}`]);
    if (finalDirty !== dirty || finalBranch !== branch || finalHead !== headSha || finalBranchSha !== branchSha) throw changed();
    return freeze({ objectFormat, branch, headSha, headTreeSha, baseSha, touchedPaths: Object.freeze(touchedPaths), entries: Object.freeze(entries) });
  }

  private async touchedPaths(repositoryPath: string, baseSha: string, headSha: string): Promise<string[]> {
    const raw = await this.bytes(repositoryPath, ["diff", "--name-status", "-z", "--find-renames", "--find-copies-harder", baseSha, headSha]);
    const records = splitZero(raw), paths = new Set<string>();
    for (let index = 0; index < records.length;) {
      const status = records[index++]!;
      if (!/^(?:[AMDT]|[RC][0-9]{1,3})$/.test(status.toString("ascii"))) throw invalidTree();
      const names = /^(?:R|C)/.test(status.toString("ascii")) ? 2 : 1;
      for (let count = 0; count < names; count++) { const bytes = records[index++]; if (!bytes) throw invalidTree(); const path = utf8Path(bytes); paths.add(path); }
    }
    return [...paths].sort();
  }

  private async text(repositoryPath: string, args: string[]): Promise<string> { try { return (await execute(this.executable, ["-C", repositoryPath, ...args], { encoding: "utf8", env: sanitizedGitEnvironment(), timeout: DEFAULT_GIT_COMMAND_TIMEOUT_MS, maxBuffer: DEFAULT_GIT_COMMAND_MAX_OUTPUT_BYTES, killSignal: "SIGKILL" })).stdout.trim(); } catch { throw changed(); } }
  private async bytes(repositoryPath: string, args: string[]): Promise<Buffer> { return new Promise((resolve, reject) => execFile(this.executable, ["-C", repositoryPath, ...args], { encoding: "buffer", env: sanitizedGitEnvironment(), timeout: DEFAULT_GIT_COMMAND_TIMEOUT_MS, maxBuffer: DEFAULT_GIT_COMMAND_MAX_OUTPUT_BYTES, killSignal: "SIGKILL" }, (error, stdout) => error ? reject(changed()) : resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)))); }
}

function splitZero(value: Buffer): Buffer[] { const records: Buffer[] = []; let start = 0; for (let index = 0; index < value.length; index++) if (value[index] === 0) { if (index > start) records.push(value.subarray(start, index)); start = index + 1; } if (start !== value.length) throw invalidTree(); return records; }
function utf8Path(bytes: Buffer): string { const path = bytes.toString("utf8"); if (!Buffer.from(path, "utf8").equals(bytes) || !safePath(path)) throw invalidTree(); return path; }
function safePath(path: string): boolean { return path.length > 0 && path.length <= 4096 && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && !path.split("/").some((part) => part === "" || part === "." || part === "..") && Buffer.byteLength(path, "utf8") <= 4096; }
function safeBranch(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(value) && !value.includes("//") && !value.endsWith("/") && !value.split("/").some((part) => part === "." || part === ".."); }
function fullSha(value: string): boolean { return /^[a-f0-9]{40}$/.test(value) || /^[a-f0-9]{64}$/.test(value); }
function changed(): SingleRepositoryError { return new SingleRepositoryError("git-observation-changed", "Single-repository worktree, branch, or exact head changed before certification."); }
function invalidTree(): SingleRepositoryError { return new SingleRepositoryError("path-policy", "Single-repository tree contains a non-UTF-8 or unsupported entry; lossy path conversion is forbidden."); }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value); } return value; }
