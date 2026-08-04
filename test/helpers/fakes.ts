import { FilesystemAdapter } from "../../src/adapters/filesystem.js";
import { GitAdapter } from "../../src/adapters/git.js";
import { ProcessAdapter } from "../../src/adapters/process.js";
import { BindingDocument } from "../../src/binding/types.js";

export class MemoryFilesystem implements FilesystemAdapter {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  onRead?: (path: string, contents: string | undefined) => Promise<void>;
  onRemove?: (path: string) => Promise<void>;
  async readText(path: string): Promise<string | undefined> {
    const contents = this.files.get(path);
    const hook = this.onRead;
    this.onRead = undefined;
    if (hook) await hook(path, contents);
    return contents;
  }
  async writeTextAtomic(path: string, contents: string): Promise<void> { this.files.set(path, contents); }
  async createTextExclusive(path: string, contents: string): Promise<boolean> {
    if (this.files.has(path)) return false;
    this.files.set(path, contents);
    return true;
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
    const hook = this.onRemove;
    if (hook) await hook(path);
  }
  async removeEmptyDirectory(path: string): Promise<boolean> {
    if (!this.directories.has(path)) return false;
    if ([...this.files.keys()].some((file) => file.startsWith(`${path}/`))) return false;
    this.directories.delete(path);
    return true;
  }
  async withExclusiveDirectory<T>(path: string, operation: () => Promise<T>) {
    if (this.directories.has(path)) return { acquired: false } as const;
    this.directories.add(path);
    try { return { acquired: true, value: await operation() } as const; }
    finally {
      if (!this.directories.delete(path)) {
        const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
    }
  }
}

export class FakeGit implements GitAdapter {
  readonly commonDirectories = new Map<string, string>();
  readonly remotes = new Map<string, string | undefined>();
  async commonDirectory(path: string): Promise<string> {
    const result = this.commonDirectories.get(path);
    if (!result) throw new Error(`Unknown fake repository ${path}`);
    return result;
  }
  async remoteUrl(path: string, name: string): Promise<string | undefined> { return this.remotes.get(`${path}:${name}`); }
}

export class FakeProcess implements ProcessAdapter {
  current = new Date("2026-08-04T00:00:00.000Z");
  alive = new Set<number>();
  constructor(private readonly host = "test-host", private readonly pid = 1234) {}
  hostName(): string { return this.host; }
  processId(): number { return this.pid; }
  async isProcessAlive(pid: number): Promise<boolean> { return this.alive.has(pid); }
  now(): Date { return this.current; }
}

export class MemoryBindingStore {
  constructor(public document?: BindingDocument) {}
  async read(): Promise<BindingDocument | undefined> { return this.document; }
  async write(document: BindingDocument): Promise<void> { this.document = document; }
}
