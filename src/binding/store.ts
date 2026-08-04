import { FilesystemAdapter } from "../adapters/filesystem.js";
import { BindingError } from "./errors.js";
import { BindingDocument, BindingStore } from "./types.js";
import { validateBindingDocument } from "./service.js";

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
      const validated = validateBindingDocument(document)!;
      await this.filesystem.writeTextAtomic(this.path, `${JSON.stringify(validated, null, 2)}\n`);
    } catch (error: unknown) {
      if (error instanceof BindingError) throw error;
      throw new BindingError("binding-store-invalid", "Refusing to persist an invalid canonical version 1 binding document.");
    }
  }
}
