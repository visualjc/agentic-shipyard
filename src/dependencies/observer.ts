import { canonicalSkillPath, dependencyReceiptPath, observedFrontmatterName, observedTreeSha, type DependencyFilesystem } from "../adapters/dependency-filesystem.js";
import type { DependencyRuntime } from "../adapters/dependency-runtime.js";
import { validateCapabilityManifest } from "./schema.js";
import type { CapabilityManifest, ObservedDependencyReceipt } from "./types.js";

export type DependencyObservationRoots = Readonly<{ agentsHome: string; claudeSkillsHome?: string; cursorSkillsHome?: string }>;
export type DependencyObserver = Readonly<{ inspect(manifest: unknown): Promise<readonly ObservedDependencyReceipt[]> }>;
const text = new TextDecoder("utf-8", { fatal: true });
/** JSON.parse silently overwrites duplicate object keys.  A receipt is an
 * attestation, so ambiguity is a blocker rather than "last writer wins". */
function rejectsDuplicateJsonKeys(source: string): boolean {
  let index = 0;
  const whitespace = () => { while (/\s/.test(source[index] ?? "")) index++; };
  const string = (): string => {
    const start = index++; let escaped = false;
    while (index < source.length) { const character = source[index++]!; if (escaped) { escaped = false; continue; } if (character === "\\") { escaped = true; continue; } if (character === '"') return JSON.parse(source.slice(start, index)) as string; }
    throw new Error("unterminated");
  };
  const primitive = () => { const start = index; while (index < source.length && !/[\s,}\]]/.test(source[index]!)) index++; JSON.parse(source.slice(start, index)); };
  const value = (): void => {
    whitespace(); const character = source[index];
    if (character === '"') { string(); return; }
    if (character === "{") {
      index++; const keys = new Set<string>(); whitespace(); if (source[index] === "}") { index++; return; }
      while (true) { whitespace(); if (source[index] !== '"') throw new Error("object key"); const key = string(); if (keys.has(key)) throw new Error("duplicate key"); keys.add(key); whitespace(); if (source[index++] !== ":") throw new Error("colon"); value(); whitespace(); const delimiter = source[index++]; if (delimiter === "}") return; if (delimiter !== ",") throw new Error("object delimiter"); }
    }
    if (character === "[") { index++; whitespace(); if (source[index] === "]") { index++; return; } while (true) { value(); whitespace(); const delimiter = source[index++]; if (delimiter === "]") return; if (delimiter !== ",") throw new Error("array delimiter"); } }
    primitive();
  };
  try { value(); whitespace(); return index !== source.length; } catch { return true; }
}
const boundedJson = (body: Uint8Array | undefined): unknown => { if (!body || body.byteLength > 128 * 1024) return undefined; try { const decoded = text.decode(body); return rejectsDuplicateJsonKeys(decoded) ? undefined : JSON.parse(decoded); } catch { return undefined; } };

/** Reads only the declared ~/.agents canonical skill roots and its maintenance receipt. */
export class LocalDependencyObserver implements DependencyObserver {
  constructor(private readonly filesystem: DependencyFilesystem, private readonly runtime: DependencyRuntime, private readonly roots: DependencyObservationRoots) {}
  async inspect(manifestInput: unknown): Promise<readonly ObservedDependencyReceipt[]> {
    const manifest = validateCapabilityManifest(manifestInput), agents = this.roots.agentsHome;
    const lock = boundedJson(await this.filesystem.readFile(dependencyReceiptPath(agents), 128 * 1024));
    return Promise.all(manifest.dependencies.map(async dependency => {
      const runtimes = await Promise.all(dependency.hosts.map(async host => { const version = await this.runtime.version(host); return version ? { kind: "runtime-version" as const, host, version } : undefined; }));
      if (dependency.id === "codex") return { id: dependency.id, content: dependency.content, discoveryPaths: [], invocation: { command: dependency.invocation.command, frontmatterName: dependency.invocation.frontmatterName }, runtimes: runtimes.filter((value): value is NonNullable<typeof value> => Boolean(value)) };
      if (dependency.content.kind === "matt-skill-trees") {
        const content = dependency.content;
        const metadata = await Promise.all(content.skills.map(async skill => {
          const root = canonicalSkillPath(agents, skill.name), physical = await this.filesystem.realpath(root);
          if (!physical) return undefined;
          const files: string[] = [];
          for (const file of skill.requiredFiles) { const entry = await this.filesystem.lstat(`${root}/${file}`); if (entry && (file.includes("/") || entry.kind === "file" || entry.kind === "directory")) files.push(file); }
          return { name: skill.name, frontmatterName: await observedFrontmatterName(this.filesystem, root) ?? "", files };
        }));
        const trees = await Promise.all(content.skills.map(async skill => { const treeSha = await observedTreeSha(this.filesystem, canonicalSkillPath(agents, skill.name)); return treeSha ? { ...skill, treeSha } : undefined; }));
        const canonical = await Promise.all(content.skills.map(skill => this.filesystem.realpath(canonicalSkillPath(agents, skill.name))));
        const extras = await Promise.all([this.roots.claudeSkillsHome, this.roots.cursorSkillsHome].filter((value): value is string => Boolean(value)).flatMap(home => content.skills.map(async (skill, index) => ({ index, physical: await this.filesystem.realpath(`${home}/${skill.name}`) }))));
        const hasExternalDuplicate = extras.some(value => value.physical && value.physical !== canonical[value.index]);
        const observedSkills = trees.filter((value): value is NonNullable<typeof value> => Boolean(value));
        const source = sourceFromLock(lock, dependency.id, content.skills);
        return { id: dependency.id, ...(source ? { source } : {}), ...(observedSkills.length === content.skills.length ? { content: { kind: "matt-skill-trees" as const, skills: observedSkills } } : {}), discoveryPaths: discovery(canonical, dependency.canonicalDiscovery, hasExternalDuplicate), invocation: { command: dependency.invocation.command, frontmatterName: metadata.find(value => value?.name === dependency.invocation.frontmatterName)?.frontmatterName }, skillMetadata: metadata.filter((value): value is NonNullable<typeof value> => Boolean(value)), runtimes: runtimes.filter((value): value is NonNullable<typeof value> => Boolean(value)) };
      }
      if (dependency.content.kind !== "git-tree") throw new Error("Only declared skill-tree dependencies may be observed.");
      const root = canonicalSkillPath(agents, "ccpm"), physical = await this.filesystem.realpath(root);
      const extras = await Promise.all([this.roots.claudeSkillsHome, this.roots.cursorSkillsHome].filter((value): value is string => Boolean(value)).map(home => this.filesystem.realpath(`${home}/ccpm`)));
      const hasExternalDuplicate = extras.some(extra => extra && extra !== physical);
      const files: string[] = [];
      for (const file of dependency.content.requiredFiles) if (await this.filesystem.lstat(`${root}/${file}`)) files.push(file);
      const treeSha = physical ? await observedTreeSha(this.filesystem, root) : undefined;
      const source = sourceFromLock(lock, dependency.id, [{ name: "ccpm", sourcePath: dependency.content.subpath, treeSha: dependency.content.treeSha }]);
      return { id: dependency.id, ...(source ? { source } : {}), ...(treeSha ? { content: { ...dependency.content, treeSha } } : {}), discoveryPaths: discovery([physical], dependency.canonicalDiscovery, hasExternalDuplicate), invocation: { command: dependency.invocation.command, frontmatterName: await observedFrontmatterName(this.filesystem, root) }, skillMetadata: [{ name: "ccpm", frontmatterName: await observedFrontmatterName(this.filesystem, root) ?? "", files }], runtimes: runtimes.filter((value): value is NonNullable<typeof value> => Boolean(value)) };
    }));
  }
}
function discovery(paths: readonly (string | undefined)[], expected: readonly string[], duplicate = false): readonly string[] { return paths.every(Boolean) ? duplicate ? [...expected, ".agents/skills/duplicate"] : expected : []; }
function sourceFromLock(lock: unknown, id: string, skills?: readonly Readonly<{ name: string; sourcePath: string; treeSha: string }>[]): { kind: "git-commit"; repository: string; commit: string } | undefined {
  // v3 skills-cli receipt; receipt values are corroboration only, never authority.
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) return undefined;
  const root = lock as Record<string, unknown>; if (root.version !== 3 || !root.skills || typeof root.skills !== "object" || Array.isArray(root.skills)) return undefined;
  const entries = root.skills as Record<string, unknown>;
  const required = skills;
  if (!required || required.length > 20) return undefined;
  const rows = required.map(skill => entries[skill.name]).map(value => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined);
  if (rows.some(value => !value)) return undefined;
  const repository = id === "matt-skills" ? "mattpocock/skills" : "visualjc/ccpm";
  const commit = id === "matt-skills" ? "2ab958093e83e0ec752e6c1c5932da465bf23e0c" : "cdb97474904ab2cdc7d391aa17393b444a28be3e";
  // The skills CLI v3 lock records the path to SKILL.md and currently writes
  // the GitHub clone URL with a .git suffix.  Both spellings below are the
  // same fixed reviewed source; accepting neither broadens provenance.
  if (rows.some((row, index) => row!.source !== repository || row!.sourceType !== "github" || ![`https://github.com/${repository}`, `https://github.com/${repository}.git`].includes(row!.sourceUrl as string) || row!.ref !== commit || row!.skillPath !== `${required[index]!.sourcePath}/SKILL.md` || row!.skillFolderHash !== required[index]!.treeSha)) return undefined;
  return { kind: "git-commit", repository: `https://github.com/${repository}`, commit };
}
