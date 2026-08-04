import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Narrow filesystem boundary. Production code and tests can supply different implementations. */
export interface FilesystemAdapter {
  readText(path: string): Promise<string | undefined>;
  writeTextAtomic(path: string, contents: string): Promise<void>;
  /** Returns false when a file already exists; it must never overwrite it. */
  createTextExclusive(path: string, contents: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

export const nodeFilesystem: FilesystemAdapter = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  async writeTextAtomic(path, contents) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  },
  async createTextExclusive(path, contents) {
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },
  async remove(path) {
    await rm(path, { force: true });
  },
};
