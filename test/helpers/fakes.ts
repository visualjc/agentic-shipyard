import { FilesystemAdapter } from "../../src/adapters/filesystem.js";
import { GitAdapter } from "../../src/adapters/git.js";
import { ProcessAdapter } from "../../src/adapters/process.js";
import { BindingDocument } from "../../src/binding/types.js";

export class MemoryFilesystem implements FilesystemAdapter {
  readonly files = new Map<string, string>();
  async readText(path: string): Promise<string | undefined> { return this.files.get(path); }
  async writeTextAtomic(path: string, contents: string): Promise<void> { this.files.set(path, contents); }
  async createTextExclusive(path: string, contents: string): Promise<boolean> {
    if (this.files.has(path)) return false;
    this.files.set(path, contents);
    return true;
  }
  async remove(path: string): Promise<void> { this.files.delete(path); }
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
  constructor(private document?: BindingDocument) {}
  async read(): Promise<BindingDocument | undefined> { return this.document; }
  async write(document: BindingDocument): Promise<void> { this.document = document; }
}
