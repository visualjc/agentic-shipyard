import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, open, opendir, readFile, readdir, readlink, realpath, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "./git-transport.js";
import { GRAPH_COMMAND_MAX_BYTES } from "../graph/command.js";
import type { CodeGraphFiles } from "../graph/codegraph.js";
import type { GraphifyFiles, LocalGraphCommand } from "../graph/graphify.js";
import { snapshotGraphExecutableObservation, type GraphArtifactExpectation } from "../graph/artifact.js";
import type { GraphCacheLock } from "../graph/types.js";
import { validateGraphLock } from "../graph/validation.js";

const execFileAsync = promisify(execFile);
const CHILD_TIMEOUT_MS = 30_000;
const CHILD_MAX_BUFFER = GRAPH_COMMAND_MAX_BYTES;
const PRODUCT_TREE_MAX_ENTRIES = 200_000;
const PRODUCT_TREE_MAX_BYTES = 512 * 1024 * 1024;
// The reviewed Graphify pin may own only these exact top-level leak roots.
const GRAPHIFY_OWNED_LEAK_ROOTS = [".graphify", "graphify-out"] as const;
type ProductTreeEntry = Readonly<{ identity: string; signature: string; kind: "directory" | "file" | "symlink" }>;
type ProductTreeSnapshot = Readonly<{ root: string; entries: ReadonlyMap<string, ProductTreeEntry> }>;
const productTreeObservations = new WeakMap<object, ProductTreeSnapshot>();

export function createNodeLocalGraphCommand(requested: { timeoutMs?: number; maxBytes?: number } = {}): LocalGraphCommand {
  const timeoutMs = Number.isSafeInteger(requested.timeoutMs) && (requested.timeoutMs ?? 0) > 0 ? Math.min(requested.timeoutMs!, CHILD_TIMEOUT_MS) : CHILD_TIMEOUT_MS;
  const maxBytes = Number.isSafeInteger(requested.maxBytes) && (requested.maxBytes ?? 0) > 0 ? Math.min(requested.maxBytes!, CHILD_MAX_BUFFER) : CHILD_MAX_BUFFER;
  return {
    async observe(executable, expectation) {
      try {
        const expected = snapshotExpectation(expectation); if (!expected) return undefined;
        const canonical = await canonicalExecutable(executable); const versionResult = await runVerified(canonical, ["--version"], dirname(canonical), {}, timeoutMs, maxBytes, expected.artifactSha256);
        const version = versionResult.stdout.trim();
        if (versionResult.code !== 0 || versionResult.timedOut || versionResult.stderr !== "" || !version || Buffer.byteLength(version) > 256) return undefined;
        return { executable: canonical, version, sourceReceipt: expected.sourceReceipt, artifactSha256: expected.artifactSha256 };
      } catch { return undefined; }
    },
    async run(command, args, options) {
      try { const artifact = snapshotGraphExecutableObservation(options.artifact); if (!artifact || artifact.executable !== command) return { code: 1, stdout: "", stderr: "", timedOut: false }; return runVerified(command, args, options.cwd, options.env, timeoutMs, maxBytes, artifact.artifactSha256); }
      catch { return { code: 1, stdout: "", stderr: "", timedOut: false }; }
    },
  };
}

async function runVerified(command: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string>>, timeoutMs: number, maxBytes: number, expectedSha256: string) {
  const canonical = await canonicalExecutable(command); const canonicalCwd = await realpath(cwd);
  if (!/^[0-9a-f]{64}$/.test(expectedSha256) || await sha256File(canonical) !== expectedSha256 || args.length > 64 || args.some(arg => typeof arg !== "string" || Buffer.byteLength(arg) > 4096) || Object.entries(env).some(([key, value]) => !/^[A-Z0-9_]+$/.test(key) || Buffer.byteLength(value) > 4096)) return { code: 1, stdout: "", stderr: "", timedOut: false };
  return spawnBounded(canonical, args, canonicalCwd, env, timeoutMs, maxBytes);
}

async function spawnBounded(command: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string>>, timeoutMs: number, maxBytes: number): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  if (process.platform === "win32") return { code: 1, stdout: "", stderr: "", timedOut: false };
  let child: ChildProcess;
  try { child = spawn(command, [...args], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...env, PATH: "/usr/bin:/bin", LANG: "C" } }); }
  catch { return { code: 1, stdout: "", stderr: "", timedOut: false }; }
  let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), stopped: "timeout" | "overflow" | undefined;
  let force: ReturnType<typeof setTimeout> | undefined;
  const stop = (reason: "timeout" | "overflow") => { if (stopped) return; stopped = reason; terminateTree(child, "SIGTERM"); force = setTimeout(() => terminateTree(child, "SIGKILL"), 250); };
  const collect = (target: "stdout" | "stderr", chunk: Buffer | string) => { if (stopped) return; const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); if (stdout.byteLength + stderr.byteLength + bytes.byteLength > maxBytes) { stop("overflow"); return; } if (target === "stdout") stdout = Buffer.concat([stdout, bytes]); else stderr = Buffer.concat([stderr, bytes]); };
  child.stdout?.on("data", chunk => collect("stdout", chunk)); child.stderr?.on("data", chunk => collect("stderr", chunk));
  const timeout = setTimeout(() => stop("timeout"), timeoutMs);
  let spawnError = false; child.once("error", () => { spawnError = true; });
  const closed = await new Promise<{ code: number | null }>(resolveClose => { child.once("close", code => resolveClose({ code })); });
  clearTimeout(timeout); if (force) clearTimeout(force); if (stopped) terminateTree(child, "SIGKILL");
  return stopped || spawnError ? { code: 1, stdout: "", stderr: "", timedOut: stopped === "timeout" } : { code: closed.code ?? 1, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), timedOut: false };
}

function terminateTree(child: ChildProcess, signal: NodeJS.Signals): void { const pid = child.pid; if (!pid) return; if (process.platform !== "win32") { try { process.kill(-pid, signal); } catch {} } try { child.kill(signal); } catch {} }
async function sha256File(path: string): Promise<string> { return new Promise((resolveDigest, reject) => { const hash = createHash("sha256"), stream = createReadStream(path); stream.on("error", reject); stream.on("data", chunk => hash.update(chunk)); stream.on("end", () => resolveDigest(hash.digest("hex"))); }); }
async function graphTreeDigest(root: string): Promise<string> { const hash = createHash("sha256"); let entries = 0; const walk = async (path: string, relativePath: string): Promise<void> => { if (++entries > 1_000_000) throw new Error("graph content entry limit exceeded"); const info = await lstat(path), mode = info.mode & 0o777; if (info.isSymbolicLink()) throw new Error("graph content cannot contain symlinks"); if (info.isDirectory()) { hash.update(`d\0${relativePath}\0${mode}\0`); for (const name of (await readdir(path)).sort()) await walk(join(path, name), relativePath ? `${relativePath}/${name}` : name); return; } if (!info.isFile()) throw new Error("unsupported graph content type"); hash.update(`f\0${relativePath}\0${mode}\0${info.size}\0`); for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer); hash.update("\0"); }; await walk(root, ""); return hash.digest("hex"); }
function snapshotExpectation(value: GraphArtifactExpectation): GraphArtifactExpectation | undefined { try { const d = Object.getOwnPropertyDescriptors(value); if (Object.keys(d).sort().join(",") !== "artifactSha256,sourceReceipt" || Object.values(d).some(field => !("value" in field))) return undefined; const receipt = d.sourceReceipt.value, digest = d.artifactSha256.value; return typeof receipt === "string" && receipt.length <= 512 && typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest) ? { sourceReceipt: receipt, artifactSha256: digest } : undefined; } catch { return undefined; } }

async function snapshotProductTree(root: string): Promise<ProductTreeSnapshot> {
  const entries = new Map<string, ProductTreeEntry>(), budget = { entries: 0, bytes: 0 };
  const walk = async (path: string, relativePath: string): Promise<void> => {
    if (++budget.entries > PRODUCT_TREE_MAX_ENTRIES) throw new Error("product tree entry limit exceeded");
    const entry = await productTreeEntry(path, budget); entries.set(relativePath, entry);
    if (entry.kind !== "directory") return;
    const directory = await opendir(path); for await (const item of directory) { const name = item.name; if (relativePath === "" && name === ".git") continue; await walk(join(path, name), relativePath ? `${relativePath}/${name}` : name); }
  };
  await walk(root, ""); return Object.freeze({ root, entries });
}

async function productTreeEntry(path: string, budget: { bytes: number }): Promise<ProductTreeEntry> {
  const info = await lstat(path, { bigint: true }), mode = Number(info.mode & 0o777n), baseIdentity = `${info.dev}:${info.ino}`;
  const identity = info.isDirectory() ? baseIdentity : `${baseIdentity}:${info.ctimeNs}`;
  if (info.isDirectory()) return Object.freeze({ identity, signature: `d\0${mode}`, kind: "directory" });
  if (info.isSymbolicLink()) { const target = await readlink(path); budget.bytes += Buffer.byteLength(target); if (budget.bytes > PRODUCT_TREE_MAX_BYTES) throw new Error("product tree byte limit exceeded"); const after = await lstat(path, { bigint: true }); if (`${after.dev}:${after.ino}:${after.ctimeNs}` !== identity) throw new Error("product symlink changed during observation"); return Object.freeze({ identity, signature: `l\0${mode}\0${target}`, kind: "symlink" }); }
  if (!info.isFile()) throw new Error("unsupported product tree entry");
  const size = Number(info.size); if (!Number.isSafeInteger(size) || size < 0) throw new Error("unsupported product file size"); budget.bytes += size; if (budget.bytes > PRODUCT_TREE_MAX_BYTES) throw new Error("product tree byte limit exceeded");
  const hash = createHash("sha256"); let bytes = 0; for await (const chunk of createReadStream(path)) { bytes += (chunk as Buffer).byteLength; if (bytes > size) throw new Error("product file grew during observation"); hash.update(chunk as Buffer); } const after = await lstat(path, { bigint: true }); if (bytes !== size || `${after.dev}:${after.ino}:${after.ctimeNs}` !== identity || after.size !== info.size) throw new Error("product tree changed during observation");
  return Object.freeze({ identity, signature: `f\0${mode}\0${size}\0${hash.digest("hex")}`, kind: "file" });
}

function sameProductTree(left: ProductTreeSnapshot, right: ProductTreeSnapshot): boolean { if (left.root !== right.root || left.entries.size !== right.entries.size) return false; for (const [path, entry] of left.entries) if (right.entries.get(path)?.signature !== entry.signature) return false; return true; }
function productEntryPath(root: string, relativePath: string): string { if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").some(part => !part || part === "." || part === "..")) throw new Error("unsafe product tree path"); return join(root, ...relativePath.split("/")); }
async function auditAndRestoreProductTree(before: ProductTreeSnapshot): Promise<"clean" | "restored" | "ambiguous" | "failed"> {
  let after: ProductTreeSnapshot; try { after = await snapshotProductTree(before.root); } catch { return "failed"; }
  const preExistingChange = [...before.entries].some(([path, entry]) => after.entries.get(path)?.signature !== entry.signature);
  const additions = [...after.entries].filter(([path]) => !before.entries.has(path));
  const ownedRoots = GRAPHIFY_OWNED_LEAK_ROOTS.filter(root => !before.entries.has(root) && after.entries.has(root));
  if (ownedRoots.length === 0) return preExistingChange || additions.length > 0 ? "ambiguous" : "clean";
  const ownedAdditions = additions.filter(([path]) => ownedRoots.some(root => path === root || path.startsWith(`${root}/`)));
  try {
    for (const [relativePath, expected] of ownedAdditions) { const current = await productTreeEntry(productEntryPath(before.root, relativePath), { bytes: 0 }); if (current.identity !== expected.identity || current.signature !== expected.signature) throw new Error("owned Graphify leak changed before cleanup"); }
    ownedAdditions.sort(([left], [right]) => right.split("/").length - left.split("/").length || right.localeCompare(left));
    for (const [relativePath, expected] of ownedAdditions) { const path = productEntryPath(before.root, relativePath), current = await productTreeEntry(path, { bytes: 0 }); if (current.identity !== expected.identity || current.signature !== expected.signature) throw new Error("owned Graphify leak changed during cleanup"); if (expected.kind === "directory") await rmdir(path); else await unlink(path); }
    const restored = await snapshotProductTree(before.root); if (sameProductTree(before, restored)) return "restored";
    if (ownedRoots.some(root => restored.entries.has(root))) return "failed";
    return "ambiguous";
  } catch { return "failed"; }
}

/** Defense in depth for stored baselines; live Graphify operations use the whole-tree audit above. */
export async function hasKnownProductGraphifyLeak(root: string): Promise<boolean> { return await pathExists(join(root, "graphify-out")) || await pathExists(join(root, ".graphify")); }

export function createNodeGraphFiles(gitExecutable = DEFAULT_NODE_GIT_EXECUTABLE): GraphifyFiles & CodeGraphFiles {
  const git = canonicalGitExecutable(gitExecutable);
  return {
    async canonicalPath(path) { try { return await canonicalPath(path); } catch { return undefined; } },
    async exists(path) { try { await lstat(path); return true; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } },
    async contentDigest(path) { return graphTreeDigest(path); },
    async observeProductTree(root) { const canonical = await realpath(root), snapshot = await snapshotProductTree(canonical), token = Object.freeze({}); productTreeObservations.set(token, snapshot); return token; },
    async auditProductTree(root, observation) { if (!observation || typeof observation !== "object") return { state: "failed" }; const before = productTreeObservations.get(observation); productTreeObservations.delete(observation); let canonical: string; try { canonical = await realpath(root); } catch { return { state: "failed" }; } if (!before || canonical !== before.root) return { state: "failed" }; return { state: await auditAndRestoreProductTree(before) }; },
    async copy(from, to) { await cp(from, to, { recursive: true, errorOnExist: true, force: false }); },
    async remove(path) { await rm(path, { recursive: true, force: true }); },
    async addMachineLocalExclude(root, entry) {
      if (entry !== ".codegraph/") throw new Error("unsafe graph exclusion");
      const exclude = await gitText(git, root, ["rev-parse", "--git-path", "info/exclude"]); const path = isAbsolute(exclude) ? exclude : resolve(root, exclude); const current = await boundedText(path) ?? "";
      if (!current.split(/\r?\n/).includes(entry)) { await mkdir(dirname(path), { recursive: true }); const handle = await open(path, "a", 0o600); try { await handle.writeFile(`${current && !current.endsWith("\n") ? "\n" : ""}${entry}\n`, "utf8"); } finally { await handle.close(); } }
    },
    async excluded(root, entry) { if (entry !== ".codegraph/") return false; return (await gitResult(git, root, ["check-ignore", "--no-index", "-q", ".codegraph/probe"])).code === 0; },
    async tracked(path) { const root = dirname(path), relative = basename(path); return (await gitResult(git, root, ["ls-files", "--error-unmatch", "--", relative])).code === 0; },
  };
}

export class NodeGraphLockStore {
  async read(path: string): Promise<GraphCacheLock | undefined> {
    const text = await boundedText(path); if (text === undefined) return undefined;
    try { return validateGraphLock(JSON.parse(text)); } catch { throw new Error("invalid graph lock"); }
  }
  async createExclusive(path: string, lock: GraphCacheLock): Promise<boolean> {
    await mkdir(dirname(path), { recursive: true });
    try { const handle = await open(path, "wx", 0o600); try { await handle.writeFile(JSON.stringify(validateGraphLock(lock)), "utf8"); } finally { await handle.close(); } return true; }
    catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  }
  async removeVerified(path: string, expected: GraphCacheLock): Promise<boolean> { const current = await this.read(path); if (!current || JSON.stringify(current) !== JSON.stringify(validateGraphLock(expected))) return false; await unlink(path); return true; }
}

export function graphDescriptorPath(home: string, adapter: string, worktreeInstanceId: string): string { return join(home, "graph", "descriptors", adapter, `${createHash("sha256").update(worktreeInstanceId).digest("hex")}.json`); }
export async function readGraphDescriptorText(path: string): Promise<string | undefined> { return boundedText(path); }
export async function writeGraphDescriptor(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 }); await rename(temporary, path); }
export async function removeGraphDescriptor(path: string): Promise<void> { await rm(path, { force: true }); }

async function canonicalExecutable(path: string): Promise<string> { if (!isAbsolute(path) || resolve(path) !== path) throw new Error(); const value = await realpath(path); if (!(await stat(value)).isFile()) throw new Error(); return value; }
async function canonicalPath(path: string): Promise<string> { if (!isAbsolute(path) || resolve(path) !== path) throw new Error(); try { return await realpath(path); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return join(await realpath(dirname(path)), basename(path)); } }
async function boundedText(path: string): Promise<string | undefined> { try { const value = await readFile(path); if (value.byteLength > 16 * 1024) throw new Error("local graph record exceeds its size limit"); return value.toString("utf8"); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
async function pathExists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function gitText(git: string, cwd: string, args: readonly string[]): Promise<string> { const result = await gitResult(git, cwd, args); if (result.code !== 0) throw new Error("local Git observation failed"); return result.stdout.trim(); }
async function gitResult(git: string, cwd: string, args: readonly string[]) { try { const result = await execFileAsync(git, ["-C", cwd, ...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 256 * 1024, env: sanitizedGitEnvironment({ GIT_TERMINAL_PROMPT: "0" }) }); return { code: 0, stdout: result.stdout, stderr: result.stderr }; } catch (error: unknown) { const e = error as { code?: number }; return { code: typeof e.code === "number" ? e.code : 1, stdout: "", stderr: "" }; } }
