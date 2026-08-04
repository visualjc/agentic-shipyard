import { FilesystemAdapter } from "../adapters/filesystem.js";
import { BindingError } from "./errors.js";
import { validateBinding } from "../contracts/validate.js";
import { BindingDocument, BindingStore, RepositoryBinding } from "./types.js";

export class JsonBindingStore implements BindingStore {
  constructor(private readonly filesystem: FilesystemAdapter, private readonly path: string) {}

  async read(): Promise<BindingDocument | undefined> {
    const text = await this.filesystem.readText(this.path);
    if (text === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      return validateBindingDocument(value);
    } catch {
      throw new BindingError("binding-store-invalid", "Binding store is not a valid canonical version 1 binding document.");
    }
  }

  async write(document: BindingDocument): Promise<void> {
    try {
      const validated = validateBindingDocument(document);
      await this.filesystem.writeTextAtomic(this.path, `${JSON.stringify(validated, null, 2)}\n`);
    } catch (error: unknown) {
      if (error instanceof BindingError) throw error;
      throw new BindingError("binding-store-invalid", "Refusing to persist an invalid canonical version 1 binding document.");
    }
  }
}

type UnknownRecord = Record<string, unknown>;

function validateBindingDocument(value: unknown): BindingDocument {
  const document = record(value);
  exactKeys(document, ["schemaVersion", "bindings"]);
  if (document.schemaVersion !== 1 || !Array.isArray(document.bindings)) invalid();
  return { schemaVersion: 1, bindings: document.bindings.map(validateRepositoryBinding) };
}

function validateRepositoryBinding(value: unknown): RepositoryBinding {
  try { return validateBinding(value); } catch { return invalid(); }
}

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) invalid();
}

function invalid(): never {
  throw new Error("schema mismatch");
}
