import { FilesystemAdapter } from "../adapters/filesystem.js";
import { BindingError } from "./errors.js";
import { BindingDocument, BindingStore, RemoteExpectation, RepositoryBinding, RepositoryTopology } from "./types.js";

export class JsonBindingStore implements BindingStore {
  constructor(private readonly filesystem: FilesystemAdapter, private readonly path: string) {}

  async read(): Promise<BindingDocument | undefined> {
    const text = await this.filesystem.readText(this.path);
    if (text === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      return validateBindingDocument(value);
    } catch {
      throw new BindingError("binding-store-invalid", "Binding store is not a valid version 1 binding document.");
    }
  }

  async write(document: BindingDocument): Promise<void> {
    try {
      const validated = validateBindingDocument(document);
      await this.filesystem.writeTextAtomic(this.path, `${JSON.stringify(validated, null, 2)}\n`);
    } catch (error: unknown) {
      if (error instanceof BindingError) throw error;
      throw new BindingError("binding-store-invalid", "Refusing to persist an invalid version 1 binding document.");
    }
  }
}

type UnknownRecord = Record<string, unknown>;

function validateBindingDocument(value: unknown): BindingDocument {
  const document = record(value);
  exactKeys(document, ["version", "bindings"]);
  if (document.version !== 1 || !Array.isArray(document.bindings)) invalid();
  return { version: 1, bindings: document.bindings.map(validateRepositoryBinding) };
}

function validateRepositoryBinding(value: unknown): RepositoryBinding {
  const binding = record(value);
  exactKeys(binding, ["version", "profile", "commonDirectory", "topology", "createdAt"]);
  if (binding.version !== 1) invalid();
  return {
    version: 1,
    profile: nonEmpty(binding.profile),
    commonDirectory: nonEmpty(binding.commonDirectory),
    topology: validateRepositoryTopology(binding.topology),
    createdAt: isoTimestamp(binding.createdAt),
  };
}

function validateRepositoryTopology(value: unknown): RepositoryTopology {
  const topology = record(value);
  if (topology.kind === "staged-pair") {
    exactKeys(topology, ["kind", "development", "destination"]);
    const development = validateRemote(topology.development);
    const destination = validateRemote(topology.destination);
    if (development.name === destination.name || development.url === destination.url) invalid();
    return { kind: "staged-pair", development, destination };
  }
  if (topology.kind === "single-repository") {
    exactKeys(topology, ["kind", "development"]);
    return { kind: "single-repository", development: validateRemote(topology.development) };
  }
  return invalid();
}

function validateRemote(value: unknown): RemoteExpectation {
  const remote = record(value);
  exactKeys(remote, ["name", "url"]);
  return { name: nonEmpty(remote.name), url: nonEmpty(remote.url) };
}

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) invalid();
}

function nonEmpty(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") invalid();
  return value;
}

function isoTimestamp(value: unknown): string {
  const timestamp = nonEmpty(value);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) invalid();
  return timestamp;
}

function invalid(): never {
  throw new Error("schema mismatch");
}
