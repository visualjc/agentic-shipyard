import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, readlink, realpath } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

/** This adapter is deliberately observation-only.  It has no write, git, or process port. */
export interface DependencyFilesystem {
  lstat(path: string): Promise<{ kind: "file" | "directory" | "symlink" | "other"; executable?: boolean } | undefined>;
  realpath(path: string): Promise<string | undefined>;
  readlink(path: string): Promise<string | undefined>;
  readFile(path: string, maximumBytes: number): Promise<Uint8Array | undefined>;
  readdir(path: string, maximumEntries: number): Promise<readonly Readonly<{ name: string; kind: "file" | "directory" | "symlink" | "other" }>[] | undefined>;
}

function nodeKind(value: Awaited<ReturnType<typeof lstat>>): "file" | "directory" | "symlink" | "other" {
  return value.isFile() ? "file" : value.isDirectory() ? "directory" : value.isSymbolicLink() ? "symlink" : "other";
}

const boundedObservationError = () => new Error("Dependency filesystem observation failed.");
const boundedLimitError = () => new Error("Dependency filesystem observation exceeded its bounded limit.");
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const validLimit = (value: number) => Number.isSafeInteger(value) && value >= 0;

async function readBoundedRegularFile(path: string, maximumBytes: number): Promise<Uint8Array | undefined> {
  if (!validLimit(maximumBytes)) throw boundedObservationError();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Avoid a blocking FIFO open and do not widen a path probe through a link.
    const beforeOpen = await lstat(path);
    if (!beforeOpen.isFile()) throw boundedObservationError();
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const initial = await handle.stat();
    if (!initial.isFile()) throw boundedObservationError();
    if (initial.size > maximumBytes) throw boundedLimitError();
    const limit = maximumBytes + 1, chunks: Buffer[] = [];
    let total = 0;
    while (total < limit) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    // Re-stat the opened descriptor, rather than the pathname: a file that grows
    // between the initial stat and EOF is rejected without ever being fully read.
    const final = await handle.stat();
    if (!final.isFile()) throw boundedObservationError();
    if (total > maximumBytes || final.size > maximumBytes) throw boundedLimitError();
    return Buffer.concat(chunks, total);
  } catch (error: unknown) {
    if (absent(error)) return undefined;
    if (error instanceof Error && (error.message === "Dependency filesystem observation failed." || error.message === "Dependency filesystem observation exceeded its bounded limit.")) throw error;
    throw boundedObservationError();
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

async function readBoundedDirectory(path: string, maximumEntries: number): Promise<readonly Readonly<{ name: string; kind: "file" | "directory" | "symlink" | "other" }>[] | undefined> {
  if (!validLimit(maximumEntries)) throw boundedObservationError();
  let directory: Awaited<ReturnType<typeof opendir>> | undefined;
  try {
    // opendir follows a symlink, so reject one before it can widen this probe.
    const beforeOpen = await lstat(path);
    if (!beforeOpen.isDirectory()) throw boundedObservationError();
    directory = await opendir(path);
    const entries: Array<{ name: string; kind: "file" | "directory" | "symlink" | "other" }> = [];
    for await (const entry of directory) {
      if (entries.length >= maximumEntries) throw boundedLimitError();
      entries.push({ name: entry.name, kind: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "other" });
    }
    return entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
  } catch (error: unknown) {
    if (absent(error)) return undefined;
    if (error instanceof Error && (error.message === "Dependency filesystem observation failed." || error.message === "Dependency filesystem observation exceeded its bounded limit.")) throw error;
    throw boundedObservationError();
  } finally {
    if (directory) await directory.close().catch(() => undefined);
  }
}
export const nodeDependencyFilesystem: DependencyFilesystem = {
  async lstat(path) { try { const value = await lstat(path); return { kind: nodeKind(value), executable: value.isFile() ? (value.mode & 0o111) !== 0 : undefined }; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
  async realpath(path) { try { return await realpath(path); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
  async readlink(path) { try { return await readlink(path); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "EINVAL" || (error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
  async readFile(path, maximumBytes) { return readBoundedRegularFile(path, maximumBytes); },
  async readdir(path, maximumEntries) { return readBoundedDirectory(path, maximumEntries); },
};

const inside = (root: string, candidate: string) => { const result = relative(root, candidate); return result === "" || (!result.startsWith(`..${sep}`) && result !== ".."); };
const utf8 = new TextDecoder("utf-8", { fatal: true });
const gitObject = (kind: "blob" | "tree", body: Uint8Array) => createHash("sha1").update(`${kind} ${body.byteLength}\0`).update(body).digest("hex");

/** Bounded Git-compatible tree receipt, rooted at a canonical path selected by the caller. */
export async function observedTreeSha(filesystem: DependencyFilesystem, root: string, maximumFiles = 96, maximumBytes = 512 * 1024): Promise<string | undefined> {
  const physicalRoot = await filesystem.realpath(root); if (!physicalRoot) return undefined;
  let count = 0, bytes = 0;
  const walk = async (path: string): Promise<string> => {
    const entries = await filesystem.readdir(path, 64); if (!entries) throw new Error("Dependency tree disappeared during observation.");
    const rows: Uint8Array[] = [];
    for (const entry of [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))) {
      if (!/^[^/\0]+$/.test(entry.name)) throw new Error("Dependency tree contains an unsafe entry name.");
      const child = join(path, entry.name), physical = await filesystem.realpath(child);
      if (!physical || !inside(physicalRoot, physical)) throw new Error("Dependency tree escapes its canonical root.");
      if (++count > maximumFiles) throw new Error("Dependency tree exceeds the bounded file limit.");
      const stat = await filesystem.lstat(child); if (!stat) throw new Error("Dependency tree changed during observation.");
      const directory = stat.kind === "directory";
      if (stat.kind === "symlink" || stat.kind === "other") throw new Error("Dependency content trees may not contain symlinks or special files.");
      const sha = directory ? await walk(child) : await (async () => { const body = await filesystem.readFile(child, maximumBytes); if (!body) throw new Error("Dependency file disappeared during observation."); bytes += body.byteLength; if (bytes > maximumBytes) throw new Error("Dependency tree exceeds the bounded byte limit."); return gitObject("blob", body); })();
      const mode = directory ? "40000" : stat.executable ? "100755" : "100644";
      rows.push(Buffer.concat([Buffer.from(`${mode} ${entry.name}\0`), Buffer.from(sha, "hex")]));
    }
    return gitObject("tree", Buffer.concat(rows));
  };
  return walk(physicalRoot);
}

export async function observedFrontmatterName(filesystem: DependencyFilesystem, skillRoot: string): Promise<string | undefined> {
  const body = await filesystem.readFile(join(skillRoot, "SKILL.md"), 64 * 1024); if (!body) return undefined;
  let text: string;
  try { text = utf8.decode(body); } catch { return undefined; }
  const match = /^---\r?\n([\s\S]{0,8192}?)\r?\n---\r?\n/.exec(text);
  if (!match) return undefined;
  const names = match[1].split(/\r?\n/).filter(line => /^name:\s*/.test(line));
  if (names.length !== 1) return undefined;
  const name = names[0]!.slice("name:".length).trim();
  return /^[a-z0-9][a-z0-9-]{0,127}$/.test(name) ? name : undefined;
}

export const canonicalSkillPath = (agentsHome: string, name: string) => join(resolve(agentsHome), "skills", name);
export const dependencyReceiptPath = (agentsHome: string) => join(resolve(agentsHome), ".skill-lock.json");
export const displayPath = (path: string) => basename(path) === ".skill-lock.json" ? ".agents/.skill-lock.json" : ".agents/skills";
