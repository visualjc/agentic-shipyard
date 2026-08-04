import { FilesystemAdapter } from "../adapters/filesystem.js";
import { BindingError } from "./errors.js";
import { BindingDocument, BindingStore } from "./types.js";

export class JsonBindingStore implements BindingStore {
  constructor(private readonly filesystem: FilesystemAdapter, private readonly path: string) {}

  async read(): Promise<BindingDocument | undefined> {
    const text = await this.filesystem.readText(this.path);
    if (text === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      if (!isBindingDocument(value)) throw new Error("schema mismatch");
      return value;
    } catch {
      throw new BindingError("binding-store-invalid", "Binding store is not a valid version 1 binding document.");
    }
  }

  write(document: BindingDocument): Promise<void> {
    return this.filesystem.writeTextAtomic(this.path, `${JSON.stringify(document, null, 2)}\n`);
  }
}

function isBindingDocument(value: unknown): value is BindingDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<BindingDocument>;
  return document.version === 1 && Array.isArray(document.bindings) && document.bindings.every((binding) =>
    binding && binding.version === 1 && typeof binding.profile === "string" && typeof binding.commonDirectory === "string" &&
    binding.topology && (binding.topology.kind === "staged-pair" || binding.topology.kind === "single-repository") &&
    typeof binding.topology.development?.name === "string" && typeof binding.topology.development?.url === "string" &&
    typeof binding.createdAt === "string",
  );
}
